// The pending-checkpoint slot primitives on `primary_sessions` — real SQLite:
// a patch writes only the given columns on a LIVE row; the finder answers by
// the handed-over job id; soft-deleted and unknown rows are neither patched
// nor found.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { insertPrimarySession, softDeletePrimarySession } from './primary-sessions.js'
import {
  findPrimarySessionByPendingCheckpointJobId,
  patchPendingCheckpoint,
} from './primary-session-checkpoints.js'

function seedPrimary(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const row = insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  return { user, row }
}

describe('primary-session-checkpoints repository', () => {
  it('patches the slot column by column on a LIVE row, and finds a row by its handed-over job id', async () => {
    await withTestDatabase((db) => {
      const { user, row } = seedPrimary(db)
      const at = new Date('2026-08-19T09:00:00.000Z')

      // An omitted column stays as it is.
      const marked = patchPendingCheckpoint(db, row.id, { pendingCheckpointNextStep: 'sum July', pendingCheckpointAt: at })
      expect(marked).toMatchObject({
        pendingCheckpointNextStep: 'sum July',
        pendingCheckpointAt: at,
        pendingCheckpointDepth: null,
        pendingCheckpointJobId: null,
      })
      expect(patchPendingCheckpoint(db, row.id, { pendingCheckpointDepth: 2 })).toMatchObject({
        pendingCheckpointNextStep: 'sum July',
        pendingCheckpointDepth: 2,
      })
      expect(patchPendingCheckpoint(db, row.id, { pendingCheckpointJobId: 'job-9' })!.pendingCheckpointNextStep).toBe('sum July')

      expect(findPrimarySessionByPendingCheckpointJobId(db, 'job-9')?.id).toBe(row.id)
      expect(findPrimarySessionByPendingCheckpointJobId(db, 'job-unknown')).toBeNull()

      // Only live rows: a soft-deleted primary is neither patched nor found.
      softDeletePrimarySession(db, row.id, user.id)
      expect(patchPendingCheckpoint(db, row.id, { pendingCheckpointNextStep: 'nope' })).toBeNull()
      expect(findPrimarySessionByPendingCheckpointJobId(db, 'job-9')).toBeNull()
      // …and an unknown id patches nothing.
      expect(patchPendingCheckpoint(db, 'absent', { pendingCheckpointNextStep: 'nope' })).toBeNull()
    })
  })
})
