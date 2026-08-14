// Tests for the primary-transcript resolver — the chain-walking read behind
// BOTH continuing threads (the global brain and each workspace's main chat).
// The swap-chain cases pin the tester-DB incident shape (2026-08-14): a
// context-pressure swap must never empty the visible conversation — the
// transcript spans every chain segment, chronologically. The walk-safety cases
// (cycle, foreign link) carry over from the global-root resolver this replaced.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
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
import { NotFoundError } from '@vynel/errors'
import {
  resolvePrimaryTranscript,
  resolveSessionChainTranscript,
} from './resolve-primary-transcript.js'

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

function makeWorkspace(id: string, userId: string) {
  const now = new Date()
  return {
    id,
    userId,
    name: `W ${id}`,
    kind: 'personal' as const,
    path: `/tmp/vynel/${id}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedSegment(
  db: Database,
  userId: string,
  sessionId: string,
  startedAt: Date,
  options: { continuedFrom?: string; workspaceId?: string | null } = {},
) {
  insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: options.workspaceId ?? null,
      providerId: 'claude',
      startedAt,
      title: 'Primary segment',
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

describe('resolvePrimaryTranscript', () => {
  it('returns the transcript with persisted tool calls keyed by message', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-1'))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const now = new Date()
      seedSegment(db, user.id, 'g-1', now)
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-1',
      })
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

      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.session?.id).toBe('g-1')
      expect(transcript.messages.map((message) => message.id)).toContain('asst-1')
      expect(transcript.toolCallsByMessageId['asst-1']).toHaveLength(1)
      expect(transcript.toolCallsByMessageId['asst-1']?.[0]?.toolName).toBe('send_task_to_workspace')
    })
  })

  it('returns an empty transcript (null session) for a scope with no primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-2'))
      expect(resolvePrimaryTranscript(db, { userId: user.id })).toEqual({
        session: null,
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
      seedSegment(db, user.id, 'g-old', earlier)
      seedSegment(db, user.id, 'g-new', later, { continuedFrom: 'g-old' })
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

      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.session?.id).toBe('g-new')
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-old', 'm-new'])
    })
  })

  it('a WORKSPACE primary spans its swap chain — even when the fresh segment is empty', async () => {
    await withTestDatabase(async (db) => {
      // The tester-DB incident shape: the swap just repointed the primary at a
      // fresh segment with ZERO persisted messages (the priming exchange lives
      // only in SDK storage). The transcript must still show the whole thread.
      const user = insertUser(db, makeUser('user-ws'))
      const workspace = insertWorkspace(db, makeWorkspace('ws-1', user.id))
      const primary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      const earlier = new Date('2026-08-01T00:00:00Z')
      const later = new Date('2026-08-02T00:00:00Z')
      seedSegment(db, user.id, 'ws-old', earlier, { workspaceId: workspace.id })
      seedSegment(db, user.id, 'ws-new', later, {
        workspaceId: workspace.id,
        continuedFrom: 'ws-old',
      })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'ws-new',
      })
      insertChatMessage(
        db,
        makeMessage('ws-old', { id: 'm-1', body: 'pre-swap', startedAt: earlier }),
      )
      insertChatMessage(
        db,
        makeMessage('ws-old', {
          id: 'm-2',
          role: 'assistant',
          body: 'pre-swap reply',
          startedAt: earlier,
        }),
      )

      const transcript = resolvePrimaryTranscript(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(transcript.session?.id).toBe('ws-new')
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-1', 'm-2'])
    })
  })

  it('workspace and global primaries resolve independently', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-iso'))
      const workspace = insertWorkspace(db, makeWorkspace('ws-2', user.id))
      const globalPrimary = await getOrCreatePrimarySession(db, { userId: user.id })
      const workspacePrimary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      const at = new Date('2026-08-01T00:00:00Z')
      seedSegment(db, user.id, 'g-seg', at)
      seedSegment(db, user.id, 'ws-seg', at, { workspaceId: workspace.id })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: globalPrimary.id,
        userId: user.id,
        sdkSessionId: 'g-seg',
      })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: workspacePrimary.id,
        userId: user.id,
        sdkSessionId: 'ws-seg',
      })
      insertChatMessage(db, makeMessage('g-seg', { id: 'm-global', body: 'brain', startedAt: at }))
      insertChatMessage(db, makeMessage('ws-seg', { id: 'm-ws', body: 'work', startedAt: at }))

      expect(
        resolvePrimaryTranscript(db, { userId: user.id }).messages.map((m) => m.id),
      ).toEqual(['m-global'])
      expect(
        resolvePrimaryTranscript(db, { userId: user.id, workspaceId: workspace.id }).messages.map(
          (m) => m.id,
        ),
      ).toEqual(['m-ws'])
    })
  })

  it('a cyclic chain link terminates the walk instead of hanging', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser('user-4'))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const at = new Date('2026-06-01T00:00:00Z')
      // Corrupt two-cycle: a ↔ b. The walk must stop at the first revisit.
      seedSegment(db, user.id, 'g-a', at, { continuedFrom: 'g-b' })
      seedSegment(db, user.id, 'g-b', at, { continuedFrom: 'g-a' })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-a',
      })
      insertChatMessage(db, makeMessage('g-a', { id: 'm-a', body: 'a', startedAt: at }))

      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-a'])
    })
  })

  it('resolveSessionChainTranscript spans the chain from an arbitrary owned head', async () => {
    await withTestDatabase(async (db) => {
      // The panel shape: a spawned session's folded chain opened by its newest
      // segment — no primary involved at all.
      const user = insertUser(db, makeUser('user-head'))
      const earlier = new Date('2026-08-01T00:00:00Z')
      const later = new Date('2026-08-02T00:00:00Z')
      seedSegment(db, user.id, 'sp-old', earlier)
      seedSegment(db, user.id, 'sp-new', later, { continuedFrom: 'sp-old' })
      insertChatMessage(
        db,
        makeMessage('sp-old', { id: 'm-old', body: 'before the swap', startedAt: earlier }),
      )

      const transcript = resolveSessionChainTranscript(db, {
        userId: user.id,
        headSessionId: 'sp-new',
      })
      expect(transcript.session.id).toBe('sp-new')
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-old'])
    })
  })

  it('resolveSessionChainTranscript throws NotFound on unknown, foreign, and deleted heads', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser('user-own'))
      const other = insertUser(db, makeUser('user-oth'))
      const at = new Date('2026-08-01T00:00:00Z')
      seedSegment(db, other.id, 'theirs', at)

      expect(() =>
        resolveSessionChainTranscript(db, { userId: owner.id, headSessionId: 'nope' }),
      ).toThrow(NotFoundError)
      // Same NotFound as unknown — no enumeration leak.
      expect(() =>
        resolveSessionChainTranscript(db, { userId: owner.id, headSessionId: 'theirs' }),
      ).toThrow(NotFoundError)
    })
  })

  it("a link into another user's segment ends the walk BEFORE reading it", async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser('user-5'))
      const other = insertUser(db, makeUser('user-6'))
      const primary = await getOrCreatePrimarySession(db, { userId: owner.id })
      const at = new Date('2026-06-01T00:00:00Z')
      // The foreign segment (with a message that must never surface).
      seedSegment(db, other.id, 'g-foreign', at)
      insertChatMessage(
        db,
        makeMessage('g-foreign', { id: 'm-foreign', body: 'private', startedAt: at }),
      )
      // The owner's current segment carries a corrupt link into it.
      seedSegment(db, owner.id, 'g-mine', at, { continuedFrom: 'g-foreign' })
      insertChatMessage(db, makeMessage('g-mine', { id: 'm-mine', body: 'mine', startedAt: at }))
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: owner.id,
        sdkSessionId: 'g-mine',
      })

      const transcript = resolvePrimaryTranscript(db, { userId: owner.id })
      expect(transcript.messages.map((message) => message.id)).toEqual(['m-mine'])
    })
  })
})
