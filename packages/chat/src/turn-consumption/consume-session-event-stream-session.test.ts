// Session-lifecycle tests for the SSE consumer. Covers session-started
// (new + resumed), session-completed (new + resumed), session-interrupted,
// session-errored. See sibling files for chunks/tools and approvals/happy-
// path tests. Helpers in `consume-session-event-stream-test-helpers.ts`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  findChatMessageById,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_CREATED } from '../chat-events.js'
import { imagesDirFor } from './attached-images.js'
import { consumeSessionEventStream } from './consume-session-event-stream.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import {
  PROVIDER_ID,
  makeUser,
  makeWorkspace,
  makeExistingSession,
  makeUserMessageInput,
  eventsFrom,
  drain,
} from './consume-session-event-stream-test-helpers.js'

describe('consumeSessionEventStream — session lifecycle', () => {
  it('session-started (new session) inserts session + user message + emits outbox event', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = makeUserMessageInput('Hello')

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-real-abc',
              resumedFromExisting: false,
              startedAt: new Date('2026-05-01T00:00:00Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const session = findChatSessionById(db, 'session-real-abc')
      expect(session).not.toBeNull()
      expect(session!.workspaceId).toBe(ws.id)
      expect(session!.totalMessageCount).toBe(1)

      const userMsg = findChatMessageById(db, userMessageInput.id)
      expect(userMsg?.role).toBe('user')
      expect(userMsg?.body).toBe('Hello')
      expect(userMsg?.sessionId).toBe('session-real-abc')

      const outboxEvents = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect(outboxEvents).toHaveLength(1)
      expect(outboxEvents[0]!.payload).toMatchObject({
        userId: user.id,
        workspaceId: ws.id,
        sessionId: 'session-real-abc',
        providerId: PROVIDER_ID,
      })

      expect(events.map((e) => e.kind)).toEqual(['user-message-persisted', 'session-created'])
    })
  })

  it('session-started (resume) inserts user message into existing session; does NOT insert session + does NOT emit', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const existing = insertChatSession(db, {
        ...makeExistingSession(user.id, ws.id, 'session-existing'),
        totalMessageCount: 5,
        lastMessageAt: new Date('2026-04-15T00:00:00Z'),
      })
      const userMessageInput = makeUserMessageInput('Resume me')

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-existing',
              resumedFromExisting: true,
              startedAt: new Date('2026-05-20T00:00:00Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: false,
        }),
      )

      const after = findChatSessionById(db, existing.id)
      expect(after?.totalMessageCount).toBe(5)
      expect(after?.lastMessageAt.toISOString()).toBe('2026-05-20T00:00:00.000Z')

      const userMsg = findChatMessageById(db, userMessageInput.id)
      expect(userMsg?.sessionId).toBe(existing.id)

      expect(listOutboxEventsByType(db, CHAT_SESSION_CREATED)).toHaveLength(0)
      expect(events.map((e) => e.kind)).toEqual(['user-message-persisted'])
    })
  })

  it('session-completed (new session) generates + sets title; yields session-titled then session-completed', async () => {
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
              kind: 'session-completed',
              sessionId: 'session-c',
              isNewSession: true,
              completedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Find me an apartment in Lisbon'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const session = findChatSessionById(db, 'session-c')
      expect(session?.title).toBe('Find me an apartment in Lisbon')

      const kinds = events.map((e) => e.kind)
      expect(kinds).toContain('session-titled')
      expect(kinds).toContain('session-completed')
      expect(kinds.indexOf('session-titled')).toBeLessThan(kinds.indexOf('session-completed'))
    })
  })

  it('session-completed (resumed) does NOT regenerate title', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const existing = insertChatSession(db, {
        ...makeExistingSession(user.id, ws.id, 'session-resume'),
        title: 'Existing title — not overwritten',
        totalMessageCount: 3,
      })

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: existing.id,
              resumedFromExisting: true,
              startedAt: new Date(),
            },
            {
              kind: 'session-completed',
              sessionId: existing.id,
              isNewSession: false,
              completedAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('continue'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: false,
        }),
      )

      const after = findChatSessionById(db, existing.id)
      expect(after?.title).toBe('Existing title — not overwritten')
      expect(events.map((e) => e.kind)).not.toContain('session-titled')
    })
  })

  it('session-interrupted yields session-interrupted (no DB write)', async () => {
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
              sessionId: 'session-i',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            { kind: 'session-interrupted', sessionId: 'session-i', interruptedAt: new Date() },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      expect(events.map((e) => e.kind)).toContain('session-interrupted')
    })
  })

  it('session-errored marks the last assistant message with error + yields session-errored', async () => {
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
              sessionId: 'session-e',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-e',
              messageId: 'msg-partial',
              textDelta: 'I was about to',
              isFinalChunk: false,
            },
            {
              kind: 'session-errored',
              sessionId: 'session-e',
              errorCode: 'CONTEXT_OVERFLOW',
              errorMessage: 'Conversation too long.',
              isRecoverable: false,
              erroredAt: new Date(),
            },
          ]),
          userMessageInput: makeUserMessageInput('Hi'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const errored = findChatMessageById(db, 'msg-partial')
      expect(errored?.errorCode).toBe('CONTEXT_OVERFLOW')
      expect(errored?.errorMessage).toBe('Conversation too long.')
      expect(errored?.body).toBe('I was about to')

      const yielded = events.find((e) => e.kind === 'session-errored')
      expect(yielded).toBeDefined()
      expect((yielded as Extract<ChatTurnEvent, { kind: 'session-errored' }>).isRecoverable).toBe(
        false,
      )
    })
  })

  it('persists attached image bytes to the session images dir on session-started', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const workspacePath = path.join(os.tmpdir(), `vynel-att-${randomUUID()}`)
      const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

      const userMessageInput = {
        ...makeUserMessageInput('look at this'),
        attachedImagesMetadata: [{ filename: 'shot.png', mimeType: 'image/png', sizeBytes: 4 }],
        attachedImages: [{ filename: 'shot.png', mimeType: 'image/png', base64Data: pngBase64 }],
      }

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-img',
              resumedFromExisting: false,
              startedAt: new Date(),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          workspacePath,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      // The user-message row carries the references...
      const message = findChatMessageById(db, userMessageInput.id)
      expect(message?.attachedImagesMetadata).toEqual([
        { filename: 'shot.png', mimeType: 'image/png', sizeBytes: 4 },
      ])
      // ...and the bytes land on disk for re-display.
      const onDisk = await readFile(
        path.join(imagesDirFor(workspacePath, 'session-img'), 'shot.png'),
      )
      expect(onDisk.toString('base64')).toBe(pngBase64)
    })
  })

  it('stamps messageAttribution on the user row + assistant rows (the routed-turn identity)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = makeUserMessageInput('create a readme')

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-routed-1',
              resumedFromExisting: false,
              startedAt: new Date('2026-07-06T00:00:00Z'),
            },
            {
              kind: 'text-chunk',
              sessionId: 'session-routed-1',
              messageId: 'assistant-1',
              textDelta: 'On it.',
              isFinalChunk: true,
            },
            {
              kind: 'session-completed',
              sessionId: 'session-routed-1',
              isNewSession: true,
              completedAt: new Date('2026-07-06T00:00:05Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
          messageAttribution: {
            partialSessionId: 'trace-key-1',
            userSourceKind: 'global-root',
            assistantSourceKind: 'workspace-manager',
            assistantSourceLabel: 'Ava · vynel',
          },
        }),
      )

      // The task row reads "From Global" + carries the trace key.
      const task = findChatMessageById(db, userMessageInput.id)
      expect(task?.sourceKind).toBe('global-root')
      expect(task?.partialSessionId).toBe('trace-key-1')

      // The reply row carries the workspace-manager identity + the trace key.
      const reply = findChatMessageById(db, 'assistant-1')
      expect(reply?.sourceKind).toBe('workspace-manager')
      expect(reply?.sourceLabel).toBe('Ava · vynel')
      expect(reply?.partialSessionId).toBe('trace-key-1')
      expect(reply?.body).toBe('On it.')
    })
  })
})
