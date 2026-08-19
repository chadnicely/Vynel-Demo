import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  seedChatAndChannelSchedule,
  seedChatOnlySchedule,
  seedReminderSchedule,
  seedGlobalReminderSchedule,
  seedGlobalCustomSchedule,
  stubFireDeps,
} from '../test-support.js'
import { fireSchedule } from './fire-schedule.js'
import { listScheduleRunsForSchedule } from '../repositories/index.js'
import { formatScheduledTime } from '../rendering/render-schedule-channel-message.js'
import type { StubFireDeps } from '../test-support.js'
import type { ChatTurnEvent, ChatSessionResponse } from '@vynel/contracts/chat/chat-http'

// The chat turn is INJECTED via deps (no module mock — the leaf never imports
// the chat leaf). A local vi.fn stands in for `startChatTurn`; each turn-driving
// test sets its stream and passes it via `{ ...stubFireDeps(), startChatTurn }`.
const startChatTurn = vi.fn()

async function* fakeChatTurn(sessionId: string, text: string): AsyncIterable<ChatTurnEvent> {
  yield { kind: 'session-created', session: { id: sessionId } as unknown as ChatSessionResponse }
  yield { kind: 'text-chunk', messageId: 'msg-1', textDelta: text }
  yield { kind: 'session-completed', sessionId }
}

async function* erroredChatTurn(): AsyncIterable<ChatTurnEvent> {
  yield { kind: 'session-created', session: { id: 'sess-err' } as unknown as ChatSessionResponse }
  yield {
    kind: 'session-errored',
    sessionId: 'sess-err',
    errorCode: 'provider_error',
    errorMessage: 'model unavailable',
    isRecoverable: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fireSchedule', () => {
  it('runs an MCP-equipped turn, completes the run, and publishes the channel outbox event', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-1', 'Good morning, Dana.'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatAndChannelSchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date('2026-06-05T08:00:00Z'), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('sess-1')
      expect(deps.state.builtMcpServer).toBe(true) // desktop-parity: the MCP server was built

      // The turn was MCP-equipped and fresh.
      const callInput = startChatTurn.mock.calls[0]?.[1]
      expect(callInput.mcpServers).toBeDefined()
      expect('allowedMcpToolPatterns' in callInput).toBe(false)
      // test: correct expectation — the fired turn runs the RESOLVED mode
      // (target row ?? DEFAULT = auto; background-turns BT2 / hardening D3);
      // was: the hard-coded 'bypass-with-behavior-gate'.
      expect(callInput.permissionMode).toBe('auto')
      expect(callInput.scheduleRunId).toBe(run.id) // the binder's cap-lever + log key
      // test: correct expectation's WHY — the LEAF names no resume target: the
      // api binder resolves the workspace's continuing conversation UNDER the
      // workspace lock and resumes its head (schedule-on-primary, Kafi
      // 2026-08-20, reversing D3); was: "always a fresh session (D3)".
      expect(callInput.resumeSessionId).toBeUndefined()
      // The composed prompt (capabilities stub) + the disabled-capability tool
      // gate (MCP composer stub) both reached the turn — schedules turns are gated too.
      // test: correct expectation — the fired turn now ALSO joins the MCP
      // composer's per-feature prompt sections (the chat-turn divergence fix,
      // ask build 2026-07-17); was: capabilities prompt only.
      expect(callInput.systemPromptAppend).toBe('STUB_CAPABILITIES_APPEND\n\nSTUB_MCP_PROMPT_APPEND')
      expect(callInput.deniedToolNames).toEqual(['mcp__vynel__search_knowledge'])
      // The feature mutating set auto-feeds the approval backstop (additive).
      expect(callInput.alwaysRequireApprovalToolNames).toEqual(['mcp__vynel__create_memory_entry'])
      // The destructive tier forwards too — live the moment a row resolves ask.
      expect(callInput.askModeApprovalToolNames).toEqual(['mcp__vynel__remove_knowledge_source'])

      const events = listOutboxEventsByType(db, 'schedule.run-completed')
      expect(events).toHaveLength(1)
      expect((events[0]!.payload as { channelId: string }).channelId).toBe(schedule.channelId)
      const renderedOutput = (events[0]!.payload as { renderedOutput: string }).renderedOutput
      expect(renderedOutput).toContain('📅') // the header is baked in
      expect(renderedOutput).toContain('Good morning, Dana.')
    })
  })

  it('does NOT publish an outbox event for a chat-only schedule', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-2', 'hi'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }
      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )
      expect(run.status).toBe('completed')
      expect(listOutboxEventsByType(db, 'schedule.run-completed')).toHaveLength(0)
    })
  })

  // test: correct expectation — a failure now co-commits a `schedule.run-failed`
  // outbox event (core routes it into a global-root report delivery so the user
  // hears about it); was: failure published nothing at all.
  it('marks the run failed and publishes the run-failed event (never the completed one)', async () => {
    startChatTurn.mockImplementation(() => erroredChatTurn())
    await withTestDatabase(async (db) => {
      const schedule = seedChatAndChannelSchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }
      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date('2026-06-05T08:00:00Z'), triggerKind: 'poll' },
        deps,
      )
      expect(run.status).toBe('failed')
      expect(run.statusMessage).toContain('model unavailable')
      expect(listOutboxEventsByType(db, 'schedule.run-completed')).toHaveLength(0)

      const failedEvents = listOutboxEventsByType(db, 'schedule.run-failed')
      expect(failedEvents).toHaveLength(1)
      const payload = failedEvents[0]!.payload as {
        scheduleId: string
        runId: string
        userId: string
        scheduleDisplayName: string
        errorMessage: string
        firedAt: string
      }
      expect(payload.scheduleId).toBe(schedule.id)
      expect(payload.runId).toBe(run.id)
      expect(payload.userId).toBe(schedule.userId)
      expect(payload.scheduleDisplayName).toBe(schedule.displayName)
      expect(payload.errorMessage).toContain('model unavailable')
      expect(payload.firedAt).toBe('2026-06-05T08:00:00.000Z')
    })
  })

  it('delivers a verbatim reminder WITHOUT an LLM turn (no chat session, prompt delivered as-is)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedReminderSchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        {
          scheduleId: schedule.id,
          scheduledFireAt: new Date('2026-06-23T14:00:00Z'),
          triggerKind: 'manual',
        },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBeNull() // no session — the verbatim path skipped the turn
      expect(startChatTurn).not.toHaveBeenCalled()
      expect(deps.state.builtMcpServer).toBe(false) // the MCP turn machinery was never built

      // The reminder reaches the channel exactly as written (just the 📅 header
      // added) — NOT rewritten by a model.
      const events = listOutboxEventsByType(db, 'schedule.run-completed')
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as { renderedOutput: string; chatSessionId: string | null }
      expect(payload.renderedOutput).toContain('Attend your 2pm meeting.')
      expect(payload.chatSessionId).toBeNull()
    })
  })

  it('fires a GLOBAL verbatim reminder (null workspace) without a workspace lookup', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalReminderSchedule(db)
      expect(schedule.workspaceId).toBeNull()
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date('2026-06-23T14:00:00Z'), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBeNull()
      expect(startChatTurn).not.toHaveBeenCalled()
      expect(deps.state.builtMcpServer).toBe(false) // the workspace-turn machinery was never built

      const events = listOutboxEventsByType(db, 'schedule.run-completed')
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as { workspaceId: string | null; renderedOutput: string }
      expect(payload.workspaceId).toBeNull() // the outbox payload carries the null (global) scope
      expect(payload.renderedOutput).toContain('Attend your 2pm meeting.')
    })
  })
})

describe('fireSchedule — the turn settings (background-turns BT2: target row ?? DEFAULT)', () => {
  it('forwards the resolved row settings (mode / model / effort / autopilot) to the workspace turn', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-3', 'ok'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const resolveWorkspaceTurnSettings = vi.fn(() => ({
        permissionMode: 'ask',
        model: 'claude-sonnet-4-5',
        thinkingEffort: 'high' as const,
        autoBuildout: true,
      }))
      const deps = { ...stubFireDeps(), startChatTurn, resolveWorkspaceTurnSettings }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      // Resolved for THIS workspace's primary — the row the user configured.
      expect(resolveWorkspaceTurnSettings).toHaveBeenCalledWith(db, {
        userId: schedule.userId,
        workspaceId: schedule.workspaceId,
      })
      const callInput = startChatTurn.mock.calls[0]?.[1]
      expect(callInput.permissionMode).toBe('ask')
      expect(callInput.model).toBe('claude-sonnet-4-5')
      expect(callInput.thinkingEffort).toBe('high')
      expect(callInput.autoBuildout).toBe(true)
    })
  })

  it('omits model / effort / autopilot when the row resolves none (the engine defaults decide)', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-4', 'ok'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn } // the stub resolver answers the defaults

      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      const callInput = startChatTurn.mock.calls[0]?.[1]
      expect(callInput.permissionMode).toBe('auto')
      expect('model' in callInput).toBe(false)
      expect('thinkingEffort' in callInput).toBe(false)
      expect('autoBuildout' in callInput).toBe(false)
    })
  })
})

describe('fireSchedule — a GLOBAL custom schedule runs a GLOBAL-ROOT turn (background-turns BT1)', () => {
  it('fires through the injected global runner, binds the produced session, and publishes the channel event', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalCustomSchedule(db)
      expect(schedule.workspaceId).toBeNull()
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date('2026-08-20T08:00:00Z'), triggerKind: 'poll' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('global-sdk-1') // the global turn's session, bound to the run
      // The GLOBAL path: the rendered prompt is the root's user message —
      // plus the fire frame (schedule-fire framing): the marker for the
      // provider input, the schedule's system-notice label for the row. No
      // workspace turn, no workspace MCP composition.
      expect(deps.state.globalTurns).toEqual([
        {
          userId: schedule.userId,
          userMessageText: 'Sweep my inbox, Dana.',
          frame: {
            marker: `(SCHEDULE-FIRE Inbox sweep @ ${formatScheduledTime(new Date('2026-08-20T08:00:00Z'), 'UTC')})`,
            sourceLabel: 'Schedule · Inbox sweep',
          },
        },
      ])
      expect(startChatTurn).not.toHaveBeenCalled()
      expect(deps.state.builtMcpServer).toBe(false)

      // The report/delivery path is unchanged: chat-and-channel → the outbox
      // event, carrying the global scope + the produced session + the answer.
      const events = listOutboxEventsByType(db, 'schedule.run-completed')
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as {
        workspaceId: string | null
        chatSessionId: string | null
        renderedOutput: string
      }
      expect(payload.workspaceId).toBeNull()
      expect(payload.chatSessionId).toBe('global-sdk-1')
      expect(payload.renderedOutput).toContain('Inbox swept.')
    })
  })

  it('binds the session to the run row as soon as the runner names it (while still running)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalCustomSchedule(db, { destinationKind: 'chat-only', channelId: null })
      let runRowWhileRunning: string | null | undefined
      const startGlobalRootTurn: StubFireDeps['startGlobalRootTurn'] = async (turnDb, input) => {
        input.onSessionResolved?.('global-sdk-live')
        runRowWhileRunning = listScheduleRunsForSchedule(turnDb, schedule.id)[0]?.chatSessionId
        return { sessionId: 'global-sdk-live', resultText: 'done' }
      }
      const deps = { ...stubFireDeps(), startChatTurn, startGlobalRootTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(runRowWhileRunning).toBe('global-sdk-live')
      expect(run.chatSessionId).toBe('global-sdk-live')
      expect(run.status).toBe('completed')
    })
  })

  it('marks the run failed (+ the run-failed event) when the global turn rejects — e.g. the hard cap', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalCustomSchedule(db)
      const deps = {
        ...stubFireDeps(),
        startChatTurn,
        startGlobalRootTurn: async () => {
          throw new Error('exceeded the 60-minute cap')
        },
      }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'poll' },
        deps,
      )

      expect(run.status).toBe('failed')
      expect(run.statusMessage).toBe('exceeded the 60-minute cap')
      expect(listOutboxEventsByType(db, 'schedule.run-completed')).toHaveLength(0)
      const failedEvents = listOutboxEventsByType(db, 'schedule.run-failed')
      expect(failedEvents).toHaveLength(1)
      expect((failedEvents[0]!.payload as { errorMessage: string }).errorMessage).toBe(
        'exceeded the 60-minute cap',
      )
    })
  })

  it('a RESUMED continuing conversation binds the run row via user-message-persisted (no session-created on a resumed head)', async () => {
    // Schedule-on-primary: the binder resumes the workspace primary's head, so
    // the stream announces the segment only through `user-message-persisted` —
    // a leaf listening for `session-created` alone would leave the run row's
    // chatSessionId NULL and the "open the conversation" link dead.
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      let runRowWhileRunning: string | null | undefined
      startChatTurn.mockImplementation(async function* (): AsyncIterable<ChatTurnEvent> {
        yield {
          kind: 'user-message-persisted',
          message: { sessionId: 'sess-resumed-head' },
        } as unknown as ChatTurnEvent
        // The run row binds WHILE the turn still runs (the live "open it" link).
        runRowWhileRunning = listScheduleRunsForSchedule(db, schedule.id)[0]?.chatSessionId
        yield { kind: 'text-chunk', messageId: 'msg-1', textDelta: 'resumed answer' }
      })
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'poll' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('sess-resumed-head')
      expect(runRowWhileRunning).toBe('sess-resumed-head')
    })
  })

  it('a mid-turn swap rebinds the run row to the segment the turn ended on', async () => {
    // Resumed head, then a compaction swap mints a fresh segment mid-turn —
    // the run row follows (`session-created` after `user-message-persisted`),
    // and the duplicate-id guard keeps the first bind from re-writing.
    startChatTurn.mockImplementation(async function* (): AsyncIterable<ChatTurnEvent> {
      yield {
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-head-1' },
      } as unknown as ChatTurnEvent
      yield {
        kind: 'session-created',
        session: { id: 'sess-swapped-2' } as unknown as ChatSessionResponse,
      }
      yield { kind: 'text-chunk', messageId: 'msg-1', textDelta: 'post-swap answer' }
    })
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'poll' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('sess-swapped-2')
    })
  })

  it('a WORKSPACE schedule still takes the workspace path — never the global runner', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-ws', 'workspace answer'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('sess-ws')
      expect(startChatTurn).toHaveBeenCalledTimes(1)
      expect(deps.state.globalTurns).toEqual([])
    })
  })

  it('a GLOBAL verbatim reminder stays verbatim — no runner of either kind', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalReminderSchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBeNull()
      expect(deps.state.globalTurns).toEqual([])
      expect(startChatTurn).not.toHaveBeenCalled()
    })
  })
})

describe('fireSchedule — the fire frame (schedule-fire framing: the scheduler speaks, never the user)', () => {
  it('a fired WORKSPACE turn: the model reads prompt + marker, the row persists the plain prompt as a schedule system notice', async () => {
    startChatTurn.mockImplementation(() => fakeChatTurn('sess-framed', 'brewed'))
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db) // 'Morning briefing', UTC
      const deps = { ...stubFireDeps(), startChatTurn }
      const scheduledFireAt = new Date('2026-08-20T08:00:00Z')

      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt, triggerKind: 'poll' },
        deps,
      )

      // The marker was rendered from THIS schedule's facts — its display name
      // and the fire time in the schedule's OWN timezone (the channel
      // header's formatter, the one home).
      const firedAtLocal = formatScheduledTime(scheduledFireAt, schedule.timezone)
      expect(deps.state.renderedMarkers).toEqual([
        { scheduleDisplayName: 'Morning briefing', firedAtLocal },
      ])
      const callInput = startChatTurn.mock.calls[0]?.[1]
      // Persisted body = the plain rendered prompt (what the user set up)…
      expect(callInput.userMessageText).toBe('Good morning, Dana.')
      // …the MODEL reads the frame appended to it (provider input only)…
      expect(callInput.providerUserMessageText).toBe(
        `Good morning, Dana.\n\n(SCHEDULE-FIRE Morning briefing @ ${firedAtLocal})`,
      )
      // …and the row is attributed to the schedule (the UI's quiet system
      // notice), never "You".
      expect(callInput.messageAttribution).toEqual({
        userSourceKind: 'system',
        userSourceLabel: 'Schedule · Morning briefing',
      })
    })
  })

  it('a fired GLOBAL turn carries the same frame: marker + system-notice label beside the plain prompt', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalCustomSchedule(db, { displayName: 'Tea', promptTemplate: 'Remind me for tea' })
      const deps = { ...stubFireDeps(), startChatTurn }
      const scheduledFireAt = new Date('2026-08-20T14:00:00Z')

      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt, triggerKind: 'poll' },
        deps,
      )

      const firedAtLocal = formatScheduledTime(scheduledFireAt, schedule.timezone)
      expect(deps.state.renderedMarkers).toEqual([{ scheduleDisplayName: 'Tea', firedAtLocal }])
      expect(deps.state.globalTurns).toEqual([
        {
          userId: schedule.userId,
          userMessageText: 'Remind me for tea',
          frame: {
            marker: `(SCHEDULE-FIRE Tea @ ${firedAtLocal})`,
            sourceLabel: 'Schedule · Tea',
          },
        },
      ])
    })
  })

  it('a verbatim reminder renders NO marker — there is no model to frame for', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedReminderSchedule(db)
      const deps = { ...stubFireDeps(), startChatTurn }

      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(deps.state.renderedMarkers).toEqual([])
    })
  })
})
