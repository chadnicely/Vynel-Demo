// Chunks + tool-use + usage-reported tests for the SSE consumer. See sibling
// files for session-lifecycle + approval/happy-path tests. Helpers in
// `consume-session-event-stream-test-helpers.ts`.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChatSessionById,
  findChatMessageById,
  findChatToolCallByToolUseId,
} from '../repositories/index.js'
import { consumeSessionEventStream } from './consume-session-event-stream.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import {
  PROVIDER_ID,
  makeUser,
  makeWorkspace,
  makeUserMessageInput,
  eventsFrom,
  drain,
} from './consume-session-event-stream-test-helpers.js'

describe('consumeSessionEventStream — chunks + tool use + usage', () => {
  it('text-chunk creates assistant message + appends body; sets completedAt on isFinalChunk', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-x',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-x',
              messageId: 'msg-1',
              textDelta: 'Hello, ',
              isFinalChunk: false,
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-x',
              messageId: 'msg-1',
              textDelta: 'world!',
              isFinalChunk: true,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const assistant = findChatMessageById(db, 'msg-1')
      expect(assistant?.body).toBe('Hello, world!')
      expect(assistant?.completedAt).toBeInstanceOf(Date)
    })
  })

  it('thinking-chunk appends to thinkingBody; renames textDelta → thinkingDelta on yield', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-t',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'thinking-chunk',
              sessionId: 'session-t',
              messageId: 'msg-think',
              textDelta: 'Let me think… ',
              isFinalChunk: false,
            },
            {
              kind: 'thinking-chunk',
              sessionId: 'session-t',
              messageId: 'msg-think',
              textDelta: 'OK got it.',
              isFinalChunk: true,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const msg = findChatMessageById(db, 'msg-think')
      expect(msg?.thinkingBody).toBe('Let me think… OK got it.')

      const yielded = events.filter((e) => e.kind === 'thinking-chunk')
      expect(yielded).toHaveLength(2)
      expect((yielded[0] as Extract<ChatTurnEvent, { kind: 'thinking-chunk' }>).thinkingDelta).toBe(
        'Let me think… ',
      )
    })
  })

  it('tool-use-started inserts a tool-call row + yields tool-call-started', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-tu',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-tu',
              parentMessageId: 'msg-tu',
              toolUseId: 'toolu_abc',
              toolName: 'Read',
              toolInput: { file: '/tmp/x.md' },
              startedAt: new Date('2026-05-01T00:00:00Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'toolu_abc')
      expect(toolCall?.toolName).toBe('Read')
      expect(toolCall?.status).toBe('started')
      expect(toolCall?.toolInput).toEqual({ file: '/tmp/x.md' })
      expect(events.filter((e) => e.kind === 'tool-call-started')).toHaveLength(1)
    })
  })

  it('tool-use-completed updates the row + yields tool-call-completed', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-tc',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-tc',
              parentMessageId: 'msg-tc',
              toolUseId: 'toolu_xyz',
              toolName: 'Bash',
              toolInput: { cmd: 'echo hi' },
              startedAt: new Date('2026-05-01T00:00:00Z'),
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-tc',
              parentMessageId: 'msg-tc',
              toolUseId: 'toolu_xyz',
              output: { stdout: 'hi\n', exitCode: 0 },
              isError: false,
              completedAt: new Date('2026-05-01T00:00:05Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'toolu_xyz')
      expect(toolCall?.status).toBe('completed')
      expect(toolCall?.isErrorResult).toBe(false)
      expect(toolCall?.toolOutput).toEqual({ stdout: 'hi\n', exitCode: 0 })
      expect(events.filter((e) => e.kind === 'tool-call-completed')).toHaveLength(1)
    })
  })

  it('tool-use-completed with isError=true marks status=failed', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-tf',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-tf',
              parentMessageId: 'msg-tf',
              toolUseId: 'toolu_fail',
              toolName: 'Bash',
              toolInput: {},
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-tf',
              parentMessageId: 'msg-tf',
              toolUseId: 'toolu_fail',
              output: { error: 'permission denied' },
              isError: true,
              completedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'toolu_fail')
      expect(toolCall?.status).toBe('failed')
      expect(toolCall?.isErrorResult).toBe(true)
    })
  })

  it('tool-use-completed for unknown toolUseId is logged + dropped (no DB write, no yield)', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    const logger = {
      info: () => {},
      warn: (payload: object, message?: string) => warnings.push({ payload, message }),
      error: () => {},
    }
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-orphan',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-orphan',
              parentMessageId: 'msg-x',
              toolUseId: 'toolu_orphan',
              output: {},
              isError: false,
              completedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
          logger,
        }),
      )

      expect(events.filter((e) => e.kind === 'tool-call-completed')).toHaveLength(0)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]!.message).toContain('unknown toolUseId')
    })
  })

  it('usage-reported increments session counters via SQL-side increment', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-u',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            { kind: 'usage-reported', sessionId: 'session-u', inputTokens: 100, outputTokens: 50 },
            { kind: 'usage-reported', sessionId: 'session-u', inputTokens: 200, outputTokens: 150 },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const session = findChatSessionById(db, 'session-u')
      expect(session?.totalMessageCount).toBe(3)
      expect(session?.totalInputTokens).toBe(300)
      expect(session?.totalOutputTokens).toBe(200)
    })
  })

  it('usage-reported records real context occupancy (input + cache) on the assistant message + forwards the cache split', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-c',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-c',
              messageId: 'msg-c',
              textDelta: 'Answer',
              isFinalChunk: true,
            },
            {
              kind: 'usage-reported',
              sessionId: 'session-c',
              inputTokens: 1200,
              outputTokens: 300,
              cacheReadInputTokens: 8000,
              cacheCreationInputTokens: 800,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      // Per-turn occupancy persisted on the assistant message = the full input
      // side (uncached remainder + cache read + cache creation), NOT just
      // input_tokens — the SDK caches heavily, so input_tokens alone undercounts.
      const assistant = findChatMessageById(db, 'msg-c')
      expect(assistant?.inputTokens).toBe(1200 + 8000 + 800)
      expect(assistant?.outputTokens).toBe(300)

      // The forwarded event carries the cache split for the live context breakdown.
      const usage = events.find((e) => e.kind === 'usage-reported')
      expect(usage).toMatchObject({
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadInputTokens: 8000,
        cacheCreationInputTokens: 800,
      })
    })
  })

  it('usage-reported routes occupancy to its own message by messageId (no clobber across a multi-message turn)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-m',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            // First assistant request + its per-request usage.
            {
              kind: 'text-chunk',
              sessionId: 'session-m',
              messageId: 'msg-a',
              textDelta: 'one',
              isFinalChunk: true,
            },
            {
              kind: 'usage-reported',
              sessionId: 'session-m',
              messageId: 'msg-a',
              inputTokens: 50,
              outputTokens: 10,
              cacheReadInputTokens: 60000,
            },
            // A later assistant request in the same turn (the tool-loop case) + its usage.
            {
              kind: 'text-chunk',
              sessionId: 'session-m',
              messageId: 'msg-b',
              textDelta: 'two',
              isFinalChunk: true,
            },
            {
              kind: 'usage-reported',
              sessionId: 'session-m',
              messageId: 'msg-b',
              inputTokens: 80,
              outputTokens: 20,
              cacheReadInputTokens: 90000,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      // Each message carries ITS OWN occupancy — the second report does not
      // clobber the first. The last (msg-b) is the session's current occupancy.
      expect(findChatMessageById(db, 'msg-a')?.inputTokens).toBe(50 + 60000)
      expect(findChatMessageById(db, 'msg-b')?.inputTokens).toBe(80 + 90000)
    })
  })

  it('usage-reported persists the session model (the context-window denominator)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-mdl',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'usage-reported',
              sessionId: 'session-mdl',
              model: 'claude-opus-4-8',
              inputTokens: 100,
              outputTokens: 50,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      expect(findChatSessionById(db, 'session-mdl')?.model).toBe('claude-opus-4-8')
    })
  })
})

describe('consumeSessionEventStream — SUBAGENT activity (parentToolUseId-marked events)', () => {
  // The spawning Agent call's own tool-use-started — the row subagent
  // activity persists onto.
  const agentCallStarted = {
    kind: 'tool-use-started',
    sessionId: 'session-agent',
    parentMessageId: 'msg-main',
    toolUseId: 'tu_agent_1',
    toolName: 'Agent',
    toolInput: { name: 'researcher', description: 'read the file' },
    startedAt: new Date('2026-05-01T00:00:00Z'),
  } as const

  it('persists narrative + lean tool list on the Agent row; no top-level rows for the subagent', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const startedAt = new Date('2026-05-01T00:00:01Z')
      const completedAt = new Date('2026-05-01T00:00:02Z')
      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-agent',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            agentCallStarted,
            // The subagent narrates, runs a tool, and its thinking is dropped.
            {
              kind: 'text-chunk',
              sessionId: 'session-agent',
              messageId: 'msg-sub-1',
              textDelta: 'reading ',
              isFinalChunk: false,
              parentToolUseId: 'tu_agent_1',
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-agent',
              messageId: 'msg-sub-1',
              textDelta: 'the file…',
              isFinalChunk: false,
              parentToolUseId: 'tu_agent_1',
            },
            {
              kind: 'thinking-chunk',
              sessionId: 'session-agent',
              messageId: 'msg-sub-1',
              textDelta: 'hmm',
              isFinalChunk: false,
              parentToolUseId: 'tu_agent_1',
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-agent',
              parentMessageId: 'msg-sub-1',
              toolUseId: 'tu_sub_read',
              toolName: 'Read',
              toolInput: { file_path: 'a.md' },
              startedAt,
              parentToolUseId: 'tu_agent_1',
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-agent',
              parentMessageId: 'msg-sub-1',
              toolUseId: 'tu_sub_read',
              output: 'file body',
              isError: false,
              completedAt,
              parentToolUseId: 'tu_agent_1',
            },
          ]),
          userMessageInput: makeUserMessageInput('spawn an agent'),
          userId: user.id,
          workspaceId: ws.id,
          workspacePath: ws.path,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const kinds = events.map((event) => event.kind)
      expect(kinds).toContain('agent-text-chunk')
      expect(kinds).toContain('agent-tool-started')
      expect(kinds).toContain('agent-tool-completed')
      // Subagent thinking is dropped, and NO main-transcript events leaked
      // beyond the Agent call's own start.
      expect(kinds).not.toContain('text-chunk')
      expect(kinds).not.toContain('thinking-chunk')
      expect(kinds.filter((kind) => kind === 'tool-call-started')).toHaveLength(1)

      // The activity persisted onto the spawning Agent call's row — the
      // settled source for the nested pane (survives settle/reload).
      const agentCall = findChatToolCallByToolUseId(db, 'tu_agent_1')
      expect(agentCall?.subagentNarrative).toBe('reading the file…')
      expect(agentCall?.subagentToolCalls).toEqual([
        {
          toolUseId: 'tu_sub_read',
          toolName: 'Read',
          toolInput: { file_path: 'a.md' },
          status: 'completed',
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
      ])
      // Lean by design: the subagent tool's OUTPUT is not persisted.
      expect(JSON.stringify(agentCall?.subagentToolCalls)).not.toContain('file body')

      // The subagent's own message/tool rows still must NOT exist — its
      // activity lives on the Agent row, never in the main transcript.
      expect(findChatMessageById(db, 'msg-sub-1')).toBeNull()
      expect(findChatToolCallByToolUseId(db, 'tu_sub_read')).toBeNull()
    })
  })

  it('a completing Agent call settles its lingering started entries (the subagent returned)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-agent',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            agentCallStarted,
            {
              kind: 'tool-use-started',
              sessionId: 'session-agent',
              parentMessageId: 'msg-sub-1',
              toolUseId: 'tu_sub_grep',
              toolName: 'Grep',
              toolInput: { pattern: 'x' },
              startedAt: new Date('2026-05-01T00:00:01Z'),
              parentToolUseId: 'tu_agent_1',
            },
            // No completion event for the subagent tool — then the Agent call
            // itself completes (the subagent returned its report).
            {
              kind: 'tool-use-completed',
              sessionId: 'session-agent',
              parentMessageId: 'msg-main',
              toolUseId: 'tu_agent_1',
              output: 'the final report',
              isError: false,
              completedAt: new Date('2026-05-01T00:00:09Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('spawn an agent'),
          userId: user.id,
          workspaceId: ws.id,
          workspacePath: ws.path,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const agentCall = findChatToolCallByToolUseId(db, 'tu_agent_1')
      expect(agentCall?.status).toBe('completed')
      expect(agentCall?.toolOutput).toBe('the final report')
      const entries = agentCall?.subagentToolCalls ?? []
      expect(entries).toHaveLength(1)
      expect(entries[0]!.status).toBe('completed')
      // Settled with the PARENT's completion time — never a wall-clock stamp.
      expect(entries[0]!.completedAt).toBe('2026-05-01T00:00:09.000Z')
    })
  })

  it('an ERRORED Agent call settles its lingering entries as failed — no false green checkmark', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-agent',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            agentCallStarted,
            {
              kind: 'tool-use-started',
              sessionId: 'session-agent',
              parentMessageId: 'msg-sub-1',
              toolUseId: 'tu_sub_bash',
              toolName: 'Bash',
              toolInput: { command: 'npm test' },
              startedAt: new Date('2026-05-01T00:00:01Z'),
              parentToolUseId: 'tu_agent_1',
            },
            // The run dies mid-tool — the Agent call reports an error.
            {
              kind: 'tool-use-completed',
              sessionId: 'session-agent',
              parentMessageId: 'msg-main',
              toolUseId: 'tu_agent_1',
              output: 'agent crashed',
              isError: true,
              completedAt: new Date('2026-05-01T00:00:09Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('spawn an agent'),
          userId: user.id,
          workspaceId: ws.id,
          workspacePath: ws.path,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const agentCall = findChatToolCallByToolUseId(db, 'tu_agent_1')
      expect(agentCall?.status).toBe('failed')
      expect(agentCall?.subagentToolCalls?.[0]?.status).toBe('failed')
    })
  })

  it('subagent events for an UNKNOWN Agent call still stream live but persist nothing (one warn)', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    const logger = {
      info: () => {},
      warn: (payload: object, message?: string) => warnings.push({ payload, message }),
      error: () => {},
    }
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-agent',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            // No Agent call row exists for this parent — defensive path.
            {
              kind: 'text-chunk',
              sessionId: 'session-agent',
              messageId: 'msg-sub-1',
              textDelta: 'working…',
              isFinalChunk: false,
              parentToolUseId: 'tu_agent_ghost',
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-agent',
              parentMessageId: 'msg-sub-1',
              toolUseId: 'tu_sub_x',
              toolName: 'Read',
              toolInput: {},
              startedAt: new Date(),
              parentToolUseId: 'tu_agent_ghost',
            },
          ]),
          userMessageInput: makeUserMessageInput('spawn an agent'),
          userId: user.id,
          workspaceId: ws.id,
          workspacePath: ws.path,
          providerId: PROVIDER_ID,
          isNewSession: true,
          logger,
        }),
      )

      const kinds = events.map((event) => event.kind)
      expect(kinds).toContain('agent-text-chunk')
      expect(kinds).toContain('agent-tool-started')
      // Warned ONCE for the unknown parent (not once per event).
      expect(warnings.filter((w) => w.message?.includes('unknown Agent call'))).toHaveLength(1)
    })
  })
})
