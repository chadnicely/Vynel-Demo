// Approval forwarding + end-to-end happy-path tests for the SSE consumer.
// See sibling files for session-lifecycle + chunks/tools tests. Helpers in
// `consume-session-event-stream-test-helpers.ts`.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChatSessionById,
  findChatToolCallByToolUseId,
  listChatMessagesForSession,
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

describe('consumeSessionEventStream — approvals + happy-path', () => {
  it('approval-requested forwards to UI (no DB write — approvals domain owns that state)', async () => {
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
              sessionId: 'session-app',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'approval-requested',
              sessionId: 'session-app',
              approvalRequestId: 'apr_1',
              parentMessageId: 'msg-app',
              toolName: 'Write',
              toolInput: { file: '/tmp/x.txt', content: 'hello' },
              requestedAt: new Date(),
              toolUseId: 'tu_gated',
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const requested = events.find((e) => e.kind === 'approval-requested')
      expect(requested).toBeDefined()
      expect(
        (requested as Extract<ChatTurnEvent, { kind: 'approval-requested' }>).approvalRequestId,
      ).toBe('apr_1')

      // The audit row carries the REAL tool_use id (the placeholder era is
      // over) — the JOIN onto chat_tool_calls.toolUseId matches.
      const { findApprovalRequestByProviderApprovalId } = await import('@vynel/approvals')
      expect(findApprovalRequestByProviderApprovalId(db, 'apr_1')?.toolUseId).toBe('tu_gated')
    })
  })

  it('approval-resolved forwards to UI', async () => {
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
              sessionId: 'session-apr',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'approval-resolved',
              sessionId: 'session-apr',
              approvalRequestId: 'apr_2',
              decision: { kind: 'approved' },
              resolvedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const resolved = events.find((e) => e.kind === 'approval-resolved')
      expect(resolved).toBeDefined()
      expect(
        (resolved as Extract<ChatTurnEvent, { kind: 'approval-resolved' }>).decision.kind,
      ).toBe('approved')
    })
  })

  it('a DENIED approval settles its tool row denied — the error tool_result never flips it failed', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      const resolvedAt = new Date('2026-05-01T00:00:03Z')
      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-deny',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-deny',
              parentMessageId: 'msg-deny',
              toolUseId: 'tu_denied',
              toolName: 'Bash',
              toolInput: { command: 'rm -rf build' },
              startedAt: new Date('2026-05-01T00:00:00Z'),
            },
            {
              kind: 'approval-resolved',
              sessionId: 'session-deny',
              approvalRequestId: 'apr_deny',
              decision: { kind: 'denied', reason: 'too destructive' },
              resolvedAt,
              toolUseId: 'tu_denied',
            },
            // The SDK echoes every denial as an error tool_result — this must
            // NOT overwrite the terminal 'denied' with 'failed'.
            {
              kind: 'tool-use-completed',
              sessionId: 'session-deny',
              parentMessageId: 'msg-deny',
              toolUseId: 'tu_denied',
              output: 'too destructive',
              isError: true,
              completedAt: new Date('2026-05-01T00:00:04Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'tu_denied')
      expect(toolCall?.status).toBe('denied')
      expect(toolCall?.approvalStatus).toBe('denied')
      expect(toolCall?.toolOutput).toBe('too destructive')
    })
  })

  it('a denial that resolves BEFORE the row lands still settles it denied (parked decision)', async () => {
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
              sessionId: 'session-deny-early',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'approval-resolved',
              sessionId: 'session-deny-early',
              approvalRequestId: 'apr_early',
              decision: { kind: 'denied', reason: 'no' },
              resolvedAt: new Date('2026-05-01T00:00:00Z'),
              toolUseId: 'tu_early',
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-deny-early',
              parentMessageId: 'msg-early',
              toolUseId: 'tu_early',
              toolName: 'Write',
              toolInput: {},
              startedAt: new Date('2026-05-01T00:00:01Z'),
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-deny-early',
              parentMessageId: 'msg-early',
              toolUseId: 'tu_early',
              output: 'no',
              isError: true,
              completedAt: new Date('2026-05-01T00:00:02Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'tu_early')
      expect(toolCall?.status).toBe('denied')
      expect(toolCall?.approvalStatus).toBe('denied')
    })
  })

  it('an APPROVED tool stamps approvalStatus and completes normally', async () => {
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
              sessionId: 'session-appr',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-appr',
              parentMessageId: 'msg-appr',
              toolUseId: 'tu_approved',
              toolName: 'Bash',
              toolInput: { command: 'ls' },
              startedAt: new Date('2026-05-01T00:00:00Z'),
            },
            {
              kind: 'approval-resolved',
              sessionId: 'session-appr',
              approvalRequestId: 'apr_ok',
              decision: { kind: 'approved' },
              resolvedAt: new Date('2026-05-01T00:00:01Z'),
              toolUseId: 'tu_approved',
            },
            {
              kind: 'tool-use-completed',
              sessionId: 'session-appr',
              parentMessageId: 'msg-appr',
              toolUseId: 'tu_approved',
              output: 'ok',
              isError: false,
              completedAt: new Date('2026-05-01T00:00:02Z'),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const toolCall = findChatToolCallByToolUseId(db, 'tu_approved')
      expect(toolCall?.status).toBe('completed')
      expect(toolCall?.approvalStatus).toBe('approved')
    })
  })

  it('an approval-resolved WITHOUT toolUseId (provider sibling) only forwards — no row write', async () => {
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
              sessionId: 'session-sib',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'tool-use-started',
              sessionId: 'session-sib',
              parentMessageId: 'msg-sib',
              toolUseId: 'tu_sib',
              toolName: 'Bash',
              toolInput: {},
              startedAt: new Date(),
            },
            {
              kind: 'approval-resolved',
              sessionId: 'session-sib',
              approvalRequestId: 'apr_sib',
              decision: { kind: 'denied', reason: 'no' },
              resolvedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      // Uncorrelated denial: the row stays on its normal lifecycle (here the
      // teardown reap settles it — the stream ended with it open).
      const toolCall = findChatToolCallByToolUseId(db, 'tu_sib')
      expect(toolCall?.approvalStatus).toBeNull()
      expect(toolCall?.status).toBe('cancelled')
    })
  })

  it('end-to-end: full new-session happy path produces every expected ChatTurnEvent in order', async () => {
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
              sessionId: 'session-end',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-end',
              messageId: 'msg-a',
              textDelta: 'OK ',
              isFinalChunk: false,
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-end',
              messageId: 'msg-a',
              textDelta: 'done.',
              isFinalChunk: true,
            },
            { kind: 'usage-reported', sessionId: 'session-end', inputTokens: 50, outputTokens: 10 },
            {
              kind: 'session-completed',
              sessionId: 'session-end',
              isNewSession: true,
              completedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Plan my week'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      expect(events.map((e) => e.kind)).toEqual([
        'user-message-persisted',
        'session-created',
        'text-chunk',
        'text-chunk',
        'usage-reported',
        'session-titled',
        'session-completed',
      ])

      const session = findChatSessionById(db, 'session-end')
      expect(session?.title).toBe('Plan my week')
      expect(session?.totalMessageCount).toBe(2)
      expect(session?.totalInputTokens).toBe(50)

      const messages = listChatMessagesForSession(db, 'session-end')
      expect(messages.map((m) => m.role).sort()).toEqual(['assistant', 'user'])
    })
  })
})
