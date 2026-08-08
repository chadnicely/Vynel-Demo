// Tests for the global-root transcript resolver. The session unification made the
// brain persist tool calls; this asserts the transcript carries them (keyed by
// message) so the brain chat renders them on reload — the backend half of the
// "tool calls flash and gone" fix. The third test covers the inlined swap-chain
// reconstruction (the source monitor's `reconstructRootThread`, ported into the
// resolver until the monitor package lands): a swapped primary's transcript spans
// BOTH segments, chronologically.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  insertChatSession,
  insertChatMessage,
  insertChatToolCall,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import type { Database } from '@vynel/db'
import { resolveGlobalRootTranscript } from './resolve-global-root-transcript.js'

function makeUser(id: string) {
  const now = new Date()
  return {
    id,
    displayName: 'U',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedBrainSegment(
  db: Database,
  userId: string,
  sessionId: string,
  startedAt: Date,
  options: { continuedFrom?: string } = {},
) {
  insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt,
      title: 'Global brain',
      visibility: 'hidden',
    }),
    // The chain link stays off the shared builder — only a continuation
    // segment carries a predecessor (the swap writers' rule).
    ...(options.continuedFrom !== undefined
      ? { continuedFromSessionId: options.continuedFrom }
      : {}),
  })
}

function makeMessage(
  sessionId: string,
  overrides: Partial<NewChatMessage> & { id: string },
): NewChatMessage {
  const now = new Date()
  return {
    sessionId,
    role: 'user',
    body: '',
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    ...overrides,
  }
}

describe('resolveGlobalRootTranscript', () => {
  it('returns the brain transcript with persisted tool calls keyed by message', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-1'))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const now = new Date()
      // A brain session segment (workspaceId null → scope 'global'), linked as current.
      seedBrainSegment(db, user.id, 'g-1', now)
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-1',
      })
      // An assistant message + a tool call attached to it.
      insertChatMessage(
        db,
        makeMessage('g-1', { id: 'asst-1', role: 'assistant', body: 'on it', startedAt: now }),
      )
      insertChatToolCall(db, {
        id: 'tc-1',
        parentMessageId: 'asst-1',
        toolUseId: 'tu-1',
        toolName: 'send_task_to_workspace',
        toolInput: { targetWorkspaceId: 'w1' },
        toolOutput: 'queued',
        status: 'completed',
        approvalStatus: null,
        isErrorResult: false,
        startedAt: now,
        completedAt: now,
      })

      const transcript = resolveGlobalRootTranscript(db, user.id)
      expect(transcript.messages.map((message) => message.id)).toContain('asst-1')
      expect(transcript.toolCallsByMessageId['asst-1']).toHaveLength(1)
      expect(transcript.toolCallsByMessageId['asst-1']?.[0]?.toolName).toBe('send_task_to_workspace')
    })
  })

  it('returns an empty transcript for a user with no root', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-2'))
      expect(resolveGlobalRootTranscript(db, user.id)).toEqual({
        messages: [],
        toolCallsByMessageId: {},
      })
    })
  })

  it('spans the swap-segment chain in chronological order', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-3'))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const earlier = new Date('2026-06-01T00:00:00Z')
      const later = new Date('2026-06-02T00:00:00Z')
      // Two brain segments: the original (g-old) swapped into the current
      // (g-new). The segment ROW carries the chain (`continuedFromSessionId` —
      // both swap writers stamp it); no outbox event exists, exactly the
      // mid-turn provider-swap shape that used to lose all pre-swap history
      // on reload (session-review B4).
      seedBrainSegment(db, user.id, 'g-old', earlier)
      seedBrainSegment(db, user.id, 'g-new', later, { continuedFrom: 'g-old' })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-new',
      })
      insertChatMessage(
        db,
        makeMessage('g-old', { id: 'm-old', role: 'user', body: 'first', startedAt: earlier }),
      )
      insertChatMessage(
        db,
        makeMessage('g-new', { id: 'm-new', role: 'user', body: 'second', startedAt: later }),
      )

      const transcript = resolveGlobalRootTranscript(db, user.id)
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-old', 'm-new'])
    })
  })

  it('a cyclic chain link terminates the walk instead of hanging', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-4'))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const at = new Date('2026-06-01T00:00:00Z')
      // Corrupt two-cycle: a ↔ b. The walk must stop at the first revisit.
      seedBrainSegment(db, user.id, 'g-a', at, { continuedFrom: 'g-b' })
      seedBrainSegment(db, user.id, 'g-b', at, { continuedFrom: 'g-a' })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-a',
      })
      insertChatMessage(db, makeMessage('g-a', { id: 'm-a', body: 'a', startedAt: at }))

      const transcript = resolveGlobalRootTranscript(db, user.id)
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-a'])
    })
  })

  it("a link into another user's segment ends the walk BEFORE reading it", async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser('user-5'))
      const other = insertUser(db, makeUser('user-6'))
      const primary = await getOrCreatePrimarySession(db, { userId: owner.id })
      const at = new Date('2026-06-01T00:00:00Z')
      // The foreign segment (with a message that must never surface).
      seedBrainSegment(db, other.id, 'g-foreign', at)
      insertChatMessage(
        db,
        makeMessage('g-foreign', { id: 'm-foreign', body: 'private', startedAt: at }),
      )
      // The owner's current segment carries a corrupt link into it.
      seedBrainSegment(db, owner.id, 'g-mine', at, { continuedFrom: 'g-foreign' })
      insertChatMessage(db, makeMessage('g-mine', { id: 'm-mine', body: 'mine', startedAt: at }))
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: owner.id,
        sdkSessionId: 'g-mine',
      })

      const transcript = resolveGlobalRootTranscript(db, owner.id)
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-mine'])
    })
  })
})
