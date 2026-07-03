// Approval forwarding + end-to-end happy-path tests for the SSE consumer.
// See sibling files for session-lifecycle + chunks/tools tests. Helpers in
// `consume-session-event-stream-test-helpers.ts`.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatMessagesForSession } from '../repositories/index.js'
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
