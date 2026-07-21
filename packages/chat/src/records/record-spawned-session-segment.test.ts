// Integration tests for `recordSpawnedSessionSegment` — real SQLite via
// `withTestDatabase`. Proves a spawned session's first segment is a LISTED,
// NAMED, global-grounded chat row (Slice ④: the session exists in the panel
// from birth; the first segment's title IS the identity), with the
// chat.session-created outbox co-commit.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { recordSpawnedSessionSegment } from './record-spawned-session-segment.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('recordSpawnedSessionSegment (core)', () => {
  it('inserts an empty, LISTED, named segment (scope spawned, no workspace) and co-commits chat.session-created', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const sdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSpawnedSessionSegment(db, {
        sessionId: sdkSessionId,
        userId: user.id,
        providerId: 'claude',
        name: 'Research: pricing pages',
      })

      // The row PK is the SDK id (D15 preserved).
      expect(segment.id).toBe(sdkSessionId)
      // The FIRST segment's title IS the session's name.
      expect(segment.title).toBe('Research: pricing pages')
      // Listed from birth — unlike the hidden swap segments.
      expect(segment.visibility).toBe('listed')
      expect(segment.scope).toBe('spawned')
      // Global-grounded: no workspace.
      expect(segment.workspaceId).toBeNull()
      // Starts empty — the priming exchange lives only in the runtime's storage.
      expect(segment.totalMessageCount).toBe(0)
      expect(segment.continuedFromSessionId).toBeNull()

      expect(findChatSessionById(db, sdkSessionId)?.scope).toBe('spawned')

      const events = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as ChatSessionCreatedPayload
      expect(payload).toMatchObject({
        userId: user.id,
        workspaceId: null,
        sessionId: sdkSessionId,
        providerId: 'claude',
      })
    })
  })

  it('threads a creating workspace onto the segment + the outbox payload (Slice ④b)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const now = new Date()
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const sdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSpawnedSessionSegment(db, {
        sessionId: sdkSessionId,
        userId: user.id,
        providerId: 'claude',
        name: 'Acme research',
        workspaceId: workspace.id,
      })

      // Workspace-grounded, everything else identical to the global shape.
      expect(segment.workspaceId).toBe(workspace.id)
      expect(segment.scope).toBe('spawned')
      expect(segment.visibility).toBe('listed')
      expect(segment.title).toBe('Acme research')

      const events = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect((events[0]!.payload as ChatSessionCreatedPayload).workspaceId).toBe(workspace.id)
    })
  })
})
