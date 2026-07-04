// Integration tests for `captureCompactionSummary`. Real SQLite via
// `withTestDatabase`. Proves the capture LOGIC (resolve primary by SDK session
// id -> emit `session.compacted` outbox row) independent of the live SDK
// trigger (the live auto-compaction smoke is a CEO morning task — see
// OVERNIGHT-STATUS). Spec: `docs/agent-base/session-continuity.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertPrimarySession } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { captureCompactionSummary } from './capture-compaction-summary.js'
import {
  SESSION_COMPACTED_EVENT_TYPE,
  type SessionCompactedEventPayload,
} from './session-continuity-events.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
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
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedPrimary(db: Parameters<typeof insertPrimarySession>[0], userId: string, workspaceId: string, sdkSessionId: string) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    currentSdkSessionId: sdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('captureCompactionSummary', () => {
  it('emits a session.compacted outbox event for a tracked primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-1')

      const event = await captureCompactionSummary(db, {
        sdkSessionId: 'sdk-1',
        summary: 'The user is building the agent base; key decisions captured.',
      })

      expect(event).not.toBeNull()
      expect(event?.type).toBe(SESSION_COMPACTED_EVENT_TYPE)
      const payload = event?.payload as SessionCompactedEventPayload
      expect(payload.primarySessionId).toBe(primary.id)
      expect(payload.userId).toBe(user.id)
      expect(payload.workspaceId).toBe(workspace.id)
      expect(payload.sdkSessionId).toBe('sdk-1')
      expect(payload.summary).toContain('agent base')

      // The event is durably persisted in the outbox for the (follow-up)
      // memory-write consumer.
      const persisted = listOutboxEventsByType(db, SESSION_COMPACTED_EVENT_TYPE)
      expect(persisted).toHaveLength(1)
    })
  })

  it('is a no-op when no live primary maps to the SDK session id', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(user.id))

      const event = await captureCompactionSummary(db, {
        sdkSessionId: 'sdk-untracked',
        summary: 'nothing to carry',
      })

      expect(event).toBeNull()
      expect(listOutboxEventsByType(db, SESSION_COMPACTED_EVENT_TYPE)).toHaveLength(0)
    })
  })
})
