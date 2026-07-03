// Integration tests for `recordLeafSession` — real SQLite via `withTestDatabase`.
// Proves a by-reference leaf becomes a recorded, browsable chat segment that is
// HIDDEN from the curated sidebar (gold §7 "everything recorded; list curated").
// Sibling of `record-swap-segment-session.test.ts`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatSessionsForWorkspace } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { recordLeafSession } from './record-leaf-session.js'

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

describe('recordLeafSession (core)', () => {
  it('records a HIDDEN, browsable leaf segment titled by agent + co-commits chat.session-created', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const leafSdkId = `sdk-${randomUUID()}`

      const leaf = recordLeafSession(db, {
        sessionId: leafSdkId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        agentSlug: 'researcher',
      })

      expect(leaf.id).toBe(leafSdkId)
      expect(leaf.visibility).toBe('hidden')
      expect(leaf.title).toBe('Agent: researcher')
      expect(leaf.totalMessageCount).toBe(0)

      // Recorded + browsable by id…
      expect(findChatSessionById(db, leafSdkId)?.id).toBe(leafSdkId)
      // …NOT in the curated sidebar…
      expect(listChatSessionsForWorkspace(db, workspace.id).map((row) => row.id)).not.toContain(
        leafSdkId,
      )
      // …but visible with includeHidden (the monitor's full trail).
      expect(
        listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true }).map((row) => row.id),
      ).toContain(leafSdkId)

      const events = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload as ChatSessionCreatedPayload).toMatchObject({
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: leafSdkId,
        providerId: 'claude',
      })
    })
  })
})
