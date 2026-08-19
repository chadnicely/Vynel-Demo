// `tool-use-blocked` tests for the SSE consumer — the provider's OWN safety
// check refused a call (Claude's auto-mode classifier) ahead of any approval.
// See the sibling files for session-lifecycle, chunks/tools and approval
// tests. Helpers in `consume-session-event-stream-test-helpers.ts`.

import { describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent } from '@vynel/providers'
import { findChatToolCallByToolUseId } from '../repositories/index.js'
import { consumeSessionEventStream } from './consume-session-event-stream.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger } from '../chat-types.js'
import {
  PROVIDER_ID,
  makeUser,
  makeWorkspace,
  makeUserMessageInput,
  eventsFrom,
  drain,
} from './consume-session-event-stream-test-helpers.js'

const CANNED_REFUSAL =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."

const sessionStarted: NormalizedSessionEvent = {
  kind: 'session-started',
  sessionId: 'session-blocked',
  resumedFromExisting: false,
  startedAt: new Date(),
}
const toolStarted: NormalizedSessionEvent = {
  kind: 'tool-use-started',
  sessionId: 'session-blocked',
  parentMessageId: 'msg-blocked',
  toolUseId: 'tu_blocked',
  toolName: 'Bash',
  toolInput: { command: 'ssh ops@host "crontab -"' },
  startedAt: new Date('2026-08-19T10:00:00Z'),
}
const toolBlocked: NormalizedSessionEvent = {
  kind: 'tool-use-blocked',
  sessionId: 'session-blocked',
  toolUseId: 'tu_blocked',
  toolName: 'Bash',
  reasonType: 'classifier',
  reason: 'Writing a remote crontab is irreversible without clear user intent',
  message: CANNED_REFUSAL,
  blockedAt: new Date('2026-08-19T10:00:01Z'),
}
// The SDK echoes every refusal as an error tool_result carrying the canned text.
const refusalEcho: NormalizedSessionEvent = {
  kind: 'tool-use-completed',
  sessionId: 'session-blocked',
  parentMessageId: 'msg-blocked',
  toolUseId: 'tu_blocked',
  output: CANNED_REFUSAL,
  isError: true,
  completedAt: new Date('2026-08-19T10:00:02Z'),
}

const EXPECTED_OUTPUT = {
  blockedBy: 'classifier',
  reason: 'Writing a remote crontab is irreversible without clear user intent',
  message: CANNED_REFUSAL,
}

async function consume(
  db: Database,
  events: NormalizedSessionEvent[],
  logger?: StructuralLogger,
): Promise<ChatTurnEvent[]> {
  const user = makeUser()
  insertUser(db, user)
  const ws = makeWorkspace(user.id)
  insertWorkspace(db, ws)
  return drain(
    consumeSessionEventStream({
      db,
      sessionEventStream: eventsFrom(events),
      userMessageInput: makeUserMessageInput('Hi'),
      userId: user.id,
      workspaceId: ws.id,
      providerId: PROVIDER_ID,
      isNewSession: true,
      ...(logger !== undefined ? { logger } : {}),
    }),
  )
}

function recordingLogger() {
  const warn = vi.fn()
  const logger: StructuralLogger = { info: vi.fn(), warn, error: vi.fn() }
  return { logger, warn }
}

function settledFrames(events: ChatTurnEvent[]) {
  return events.filter(
    (event): event is Extract<ChatTurnEvent, { kind: 'tool-call-completed' }> =>
      event.kind === 'tool-call-completed',
  )
}

describe('consumeSessionEventStream — tool-use-blocked', () => {
  it('block then echo: the row settles blocked with the structured reason; the echo never flips it', async () => {
    await withTestDatabase(async (db) => {
      const events = await consume(db, [sessionStarted, toolStarted, toolBlocked, refusalEcho])

      const row = findChatToolCallByToolUseId(db, 'tu_blocked')
      expect(row?.status).toBe('blocked')
      expect(row?.isErrorResult).toBe(true)
      expect(row?.toolOutput).toEqual(EXPECTED_OUTPUT)
      expect(row?.completedAt).toEqual(new Date('2026-08-19T10:00:01Z'))
      // Never touched by the refusal — no approval card was shown.
      expect(row?.approvalStatus).toBeNull()

      // ONE settle frame, the blocked row — the echo adds nothing on the wire.
      const settled = settledFrames(events)
      expect(settled).toHaveLength(1)
      expect(settled[0]!.toolCall.status).toBe('blocked')
      expect(settled[0]!.toolCall.toolOutput).toEqual(EXPECTED_OUTPUT)
    })
  })

  it('echo then block (the SDK advisory raced late): the failed row still flips to blocked', async () => {
    await withTestDatabase(async (db) => {
      const events = await consume(db, [sessionStarted, toolStarted, refusalEcho, toolBlocked])

      const row = findChatToolCallByToolUseId(db, 'tu_blocked')
      expect(row?.status).toBe('blocked')
      expect(row?.toolOutput).toEqual(EXPECTED_OUTPUT)
      expect(row?.completedAt).toEqual(new Date('2026-08-19T10:00:01Z'))

      // Two settle frames: failed (the echo) then blocked — the LAST frame is
      // the truth a live viewer ends on.
      const settled = settledFrames(events)
      expect(settled.map((frame) => frame.toolCall.status)).toEqual(['failed', 'blocked'])
    })
  })

  it('a refusal without a reason settles with the generic provider label and a null reason', async () => {
    await withTestDatabase(async (db) => {
      await consume(db, [
        sessionStarted,
        toolStarted,
        { ...toolBlocked, reasonType: null, reason: null },
        refusalEcho,
      ])

      const row = findChatToolCallByToolUseId(db, 'tu_blocked')
      expect(row?.status).toBe('blocked')
      expect(row?.toolOutput).toEqual({ blockedBy: 'provider', reason: null, message: CANNED_REFUSAL })
    })
  })

  it('logs the audit line with the tool name + deciding component — never the input', async () => {
    await withTestDatabase(async (db) => {
      const { logger, warn } = recordingLogger()
      await consume(db, [sessionStarted, toolStarted, toolBlocked, refusalEcho], logger)

      const auditCall = warn.mock.calls.find(([, message]) =>
        String(message).includes('blocked by the provider'),
      )
      expect(auditCall).toBeDefined()
      expect(auditCall![0]).toEqual({
        toolUseId: 'tu_blocked',
        toolName: 'Bash',
        reasonType: 'classifier',
      })
      expect(JSON.stringify(auditCall![0])).not.toContain('crontab')
    })
  })

  it('a block for an unknown call is dropped (logged), and a SUBAGENT block is audited only — never a row, never "unknown"', async () => {
    await withTestDatabase(async (db) => {
      const { logger, warn } = recordingLogger()
      const events = await consume(
        db,
        [
          sessionStarted,
          toolStarted,
          { ...toolBlocked, toolUseId: 'tu_never_started' },
          // The SDK's `agent_id` attribution — same tool_use id as the real row
          // on purpose: the subagent rule must fire BEFORE any row lookup.
          { ...toolBlocked, agentId: 'agent_7' },
          refusalEcho,
        ],
        logger,
      )

      // The real row: only the echo reached it — an ordinary failed settle.
      const row = findChatToolCallByToolUseId(db, 'tu_blocked')
      expect(row?.status).toBe('failed')
      expect(settledFrames(events).map((frame) => frame.toolCall.status)).toEqual(['failed'])

      // Every block is audited once (the subagent's line names the subagent);
      // only the truly unknown call is reported as dropped.
      const contextsFor = (fragment: string) =>
        warn.mock.calls
          .filter(([, message]) => String(message).includes(fragment))
          .map(([context]) => context)
      expect(contextsFor('blocked by the provider')).toEqual([
        { toolUseId: 'tu_never_started', toolName: 'Bash', reasonType: 'classifier' },
        { toolUseId: 'tu_blocked', toolName: 'Bash', reasonType: 'classifier', agentId: 'agent_7' },
      ])
      expect(contextsFor('unknown toolUseId')).toEqual([{ toolUseId: 'tu_never_started' }])
    })
  })
})
