// Tests for hardDeleteWorkspace core op.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { hardDeleteWorkspace } from './hard-delete-workspace.js'
import { WORKSPACE_DELETED_EVENT } from '../workspaces-events.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeWorkspaceAtTempPath(userId: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vynel-hd-'))
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(path.join(tempDir, 'marker.txt'), 'present')
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: tempDir,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('hardDeleteWorkspace', () => {
  it('with deleteFilesFromDisk:false removes the row but leaves the folder', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspaceAtTempPath(user.id)
      const inserted = insertWorkspace(db, ws)
      await hardDeleteWorkspace(db, { workspaceId: inserted.id, deleteFilesFromDisk: false })
      expect(findWorkspaceById(db, inserted.id)).toBeNull()
      expect(existsSync(ws.path)).toBe(true)
    })
  })

  it('with deleteFilesFromDisk:true removes both the row and the folder', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspaceAtTempPath(user.id)
      const inserted = insertWorkspace(db, ws)
      await hardDeleteWorkspace(db, { workspaceId: inserted.id, deleteFilesFromDisk: true })
      expect(findWorkspaceById(db, inserted.id)).toBeNull()
      expect(existsSync(ws.path)).toBe(false)
    })
  })

  it('publishes workspace.deleted to the outbox in the same transaction', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspaceAtTempPath(user.id)
      const inserted = insertWorkspace(db, ws)
      await hardDeleteWorkspace(db, { workspaceId: inserted.id, deleteFilesFromDisk: false })
      const events = listOutboxEventsByType(db, WORKSPACE_DELETED_EVENT)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        workspaceId: inserted.id,
        userId: user.id,
        path: ws.path,
        deleteFilesFromDisk: false,
      })
    })
  })

  it('throws NotFoundError when the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      await expect(
        hardDeleteWorkspace(db, { workspaceId: randomUUID(), deleteFilesFromDisk: false }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
