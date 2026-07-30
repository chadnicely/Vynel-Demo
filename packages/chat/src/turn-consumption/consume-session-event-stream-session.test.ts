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
  listChatMessagesForSession,
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

  it('session-errored with ZERO assistant output persists a failure row (the 529-overload shape)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const erroredAt = new Date('2026-07-30T00:03:30Z')

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-dead',
              resumedFromExisting: false,
              startedAt: new Date('2026-07-30T00:00:00Z'),
            },
            {
              kind: 'session-errored',
              sessionId: 'session-dead',
              errorCode: 'error_during_execution',
              errorMessage: 'API Error: 529 Overloaded.',
              isRecoverable: false,
              erroredAt,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hey'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      // The transcript explains the missing answer instead of sitting silent.
      const rows = listChatMessagesForSession(db, 'session-dead')
      const failureRow = rows.find((row) => row.role === 'assistant')
      expect(failureRow?.errorCode).toBe('error_during_execution')
      expect(failureRow?.errorMessage).toBe('API Error: 529 Overloaded.')
      expect(failureRow?.completedAt?.toISOString()).toBe(erroredAt.toISOString())

      const session = findChatSessionById(db, 'session-dead')
      expect(session?.lastMessageAt.toISOString()).toBe(erroredAt.toISOString())
    })
  })

  it('a resumed turn dying BEFORE session-started still persists its failure row on the resumed session', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(db, {
        ...makeExistingSession(user.id, ws.id, 'session-dead-resume'),
        totalMessageCount: 2,
        lastMessageAt: new Date('2026-07-29T00:00:00Z'),
      })
      const erroredAt = new Date('2026-07-30T00:04:00Z')

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-errored',
              sessionId: '',
              errorCode: 'provider_start_timeout',
              errorMessage: 'The Claude engine did not respond.',
              isRecoverable: true,
              erroredAt,
            },
          ]),
          userMessageInput: makeUserMessageInput('Hello again'),
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: false,
          resumeSessionId: 'session-dead-resume',
        }),
      )

      const rows = listChatMessagesForSession(db, 'session-dead-resume')
      const failureRow = rows.find((row) => row.role === 'assistant')
      expect(failureRow?.errorCode).toBe('provider_start_timeout')
      // The durability-persisted user row still precedes it.
      expect(rows.find((row) => row.role === 'user')?.body).toBe('Hello again')
    })
  })

  it('resume durability: persists the user message BEFORE any provider event (a hung/dead start never loses it)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(db, {
        ...makeExistingSession(user.id, ws.id, 'session-hang'),
        totalMessageCount: 2,
        lastMessageAt: new Date('2026-04-15T00:00:00Z'),
      })
      const userMessageInput = makeUserMessageInput('Please survive')

      // The provider produces NOTHING — the stuck-start shape (spawn/auth/
      // resume hung, stream torn down with zero events).
      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: false,
          resumeSessionId: 'session-hang',
        }),
      )

      const userMsg = findChatMessageById(db, userMessageInput.id)
      expect(userMsg?.sessionId).toBe('session-hang')
      expect(userMsg?.body).toBe('Please survive')
      expect(events.map((e) => e.kind)).toEqual(['user-message-persisted'])
    })
  })

  it('resume durability: session-started on the SAME session does not double-insert or re-emit', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(db, {
        ...makeExistingSession(user.id, ws.id, 'session-resume-ok'),
        totalMessageCount: 2,
        lastMessageAt: new Date('2026-04-15T00:00:00Z'),
      })
      const userMessageInput = makeUserMessageInput('Once only')

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-resume-ok',
              resumedFromExisting: true,
              startedAt: new Date('2026-05-20T00:00:00Z'),
            },
            {
              kind: 'session-completed',
              sessionId: 'session-resume-ok',
              isNewSession: false,
              completedAt: new Date('2026-05-20T00:01:00Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: false,
          resumeSessionId: 'session-resume-ok',
        }),
      )

      expect(events.filter((e) => e.kind === 'user-message-persisted')).toHaveLength(1)
      const userMsg = findChatMessageById(db, userMessageInput.id)
      expect(userMsg?.sessionId).toBe('session-resume-ok')
    })
  })

  it('a PRE-session error is yielded, never swallowed (was: dropped when no session id had resolved)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = makeUserMessageInput('Doomed send')

      const events = await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-errored',
              sessionId: '',
              errorCode: 'provider_start_timeout',
              errorMessage: 'The Claude engine did not respond.',
              isRecoverable: true,
              erroredAt: new Date(),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      const yielded = events.find((e) => e.kind === 'session-errored')
      expect(yielded).toBeDefined()
      expect(
        (yielded as Extract<ChatTurnEvent, { kind: 'session-errored' }>).errorCode,
      ).toBe('provider_start_timeout')
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

      // The task row reads "From Global" + carries the trace key. No
      // userSourceLabel given → the label stays null (the task shape).
      const task = findChatMessageById(db, userMessageInput.id)
      expect(task?.sourceKind).toBe('global-root')
      expect(task?.sourceLabel).toBeNull()
      expect(task?.partialSessionId).toBe('trace-key-1')

      // The reply row carries the workspace-manager identity + the trace key.
      const reply = findChatMessageById(db, 'assistant-1')
      expect(reply?.sourceKind).toBe('workspace-manager')
      expect(reply?.sourceLabel).toBe('Ava · vynel')
      expect(reply?.partialSessionId).toBe('trace-key-1')
      expect(reply?.body).toBe('On it.')
    })
  })

  it('stamps userSourceLabel on the inbound row (session-comms: a notify turn attributes the report FROM the child)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = makeUserMessageInput('Backlog has 4 stale items.')

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-notify-1',
              resumedFromExisting: false,
              startedAt: new Date('2026-07-21T00:00:00Z'),
            },
            {
              kind: 'session-completed',
              sessionId: 'session-notify-1',
              isNewSession: true,
              completedAt: new Date('2026-07-21T00:00:05Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
          messageAttribution: {
            partialSessionId: 'delivery-trace-1',
            userSourceKind: 'workspace-manager',
            userSourceLabel: 'Acme research',
          },
        }),
      )

      const inbound = findChatMessageById(db, userMessageInput.id)
      expect(inbound?.sourceKind).toBe('workspace-manager')
      expect(inbound?.sourceLabel).toBe('Acme research')
      expect(inbound?.partialSessionId).toBe('delivery-trace-1')
    })
  })

  it('stamps originChannel on the user row when the message arrived via a channel', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = {
        ...makeUserMessageInput('what is the traffic in dhaka'),
        originChannel: 'voice' as const,
      }

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-voice-1',
              resumedFromExisting: false,
              startedAt: new Date('2026-07-09T00:00:00Z'),
            },
            {
              kind: 'session-completed',
              sessionId: 'session-voice-1',
              isNewSession: true,
              completedAt: new Date('2026-07-09T00:00:05Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      expect(findChatMessageById(db, userMessageInput.id)?.originChannel).toBe('voice')
    })
  })

  it('leaves originChannel null for an app-composer message', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const userMessageInput = makeUserMessageInput('plain web message')

      await drain(
        consumeSessionEventStream({
          db,
          sessionEventStream: eventsFrom([
            {
              kind: 'session-started',
              sessionId: 'session-web-1',
              resumedFromExisting: false,
              startedAt: new Date('2026-07-09T00:00:00Z'),
            },
            {
              kind: 'session-completed',
              sessionId: 'session-web-1',
              isNewSession: true,
              completedAt: new Date('2026-07-09T00:00:05Z'),
            },
          ]),
          userMessageInput,
          userId: user.id,
          workspaceId: ws.id,
          providerId: PROVIDER_ID,
          isNewSession: true,
        }),
      )

      expect(findChatMessageById(db, userMessageInput.id)?.originChannel).toBeNull()
    })
  })
})
