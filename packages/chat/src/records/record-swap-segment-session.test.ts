// Integration tests for `recordSwapSegmentSession` — real SQLite via
// `withTestDatabase`. Proves a swap-minted SDK session becomes a recorded,
// browsable chat segment that is HIDDEN from the curated sidebar (Slice 1 §2.2
// + Slice 2: the brain shows as one entry, segments hidden but recorded).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatSessionsForWorkspace } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { recordSwapSegmentSession } from './record-swap-segment-session.js'

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

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('recordSwapSegmentSession (core)', () => {
  it('inserts an empty, HIDDEN chat segment (recorded + browsable) and co-commits chat.session-created', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const freshSdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSwapSegmentSession(db, {
        sessionId: freshSdkSessionId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
      })

      // The row PK is the SDK id (D15 preserved — the locked chat decision).
      expect(segment.id).toBe(freshSdkSessionId)
      // A segment starts empty — the priming exchange is NOT persisted to chat.
      expect(segment.totalMessageCount).toBe(0)
      expect(segment.isArchived).toBe(false)
      expect(segment.deletedAt).toBeNull()
      // Hidden from the curated sidebar (Slice 2).
      expect(segment.visibility).toBe('hidden')

      // It is a recorded session — persisted + browsable by id.
      const reloaded = findChatSessionById(db, freshSdkSessionId)
      expect(reloaded?.id).toBe(freshSdkSessionId)

      // It does NOT appear in the curated sidebar list…
      const listed = listChatSessionsForWorkspace(db, workspace.id)
      expect(listed.map((row) => row.id)).not.toContain(freshSdkSessionId)
      // …but IS visible with includeHidden (the future monitor's full trail).
      const all = listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true })
      expect(all.map((row) => row.id)).toContain(freshSdkSessionId)

      // Recorded on the activity log like any new session.
      const events = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as ChatSessionCreatedPayload
      expect(payload).toMatchObject({
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: freshSdkSessionId,
        providerId: 'claude',
      })
      // No predecessor passed → chain head.
      expect(segment.continuedFromSessionId).toBeNull()
    })
  })

  it('stamps the continuity chain link when the superseded session is passed', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const predecessorId = `sdk-${randomUUID()}`
      const freshSdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSwapSegmentSession(db, {
        sessionId: freshSdkSessionId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        continuedFromSessionId: predecessorId,
      })

      expect(segment.continuedFromSessionId).toBe(predecessorId)
      // LOOSE ref by design — the predecessor row need not exist.
      expect(findChatSessionById(db, freshSdkSessionId)?.continuedFromSessionId).toBe(
        predecessorId,
      )
    })
  })
})
