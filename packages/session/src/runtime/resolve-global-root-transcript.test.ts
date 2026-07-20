// Tests for the global-root transcript resolver. The session unification made the
// brain persist tool calls; this asserts the transcript carries them (keyed by
// message) so the brain chat renders them on reload — the backend half of the
// "tool calls flash and gone" fix. The third test covers the inlined swap-chain
// reconstruction (the source monitor's `reconstructRootThread`, ported into the
// resolver until the monitor package lands): a swapped primary's transcript spans
// BOTH segments, chronologically.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
  SESSION_SWAPPED_EVENT_TYPE,
  type SessionSwappedEventPayload,
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

function seedBrainSegment(db: Database, userId: string, sessionId: string, startedAt: Date) {
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt,
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
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
      // Two brain segments: the original (g-old) swapped into the current (g-new).
      seedBrainSegment(db, user.id, 'g-old', earlier)
      seedBrainSegment(db, user.id, 'g-new', later)
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-new',
      })
      const payload: SessionSwappedEventPayload = {
        primarySessionId: primary.id,
        userId: user.id,
        scope: 'global',
        workspaceId: null,
        fromSdkSessionId: 'g-old',
        toSdkSessionId: 'g-new',
        swappedAt: later.toISOString(),
      }
      insertOutboxEvent(db, {
        id: randomUUID(),
        type: SESSION_SWAPPED_EVENT_TYPE,
        payload,
        createdAt: later,
        processedAt: null,
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
})
