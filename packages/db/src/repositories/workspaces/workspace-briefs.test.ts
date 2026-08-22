// Repository tests for the `workspace_briefs` table — one brief per
// workspace, JSON in and out whole. Uses the LOCAL test-support helper to
// avoid the `packages/db ↔ packages/testing` workspace cycle.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from './workspaces.js'
import { findWorkspaceBriefByWorkspaceId, insertWorkspaceBrief } from './workspace-briefs.js'

function seedUserAndWorkspace(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test',
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
    name: 'Front of House',
    managerName: null,
    kind: 'personal',
    path: `/work/${randomUUID()}`,
    groupId: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

describe('workspace-briefs repository', () => {
  it('stores the answers + plan as JSON and reads them back whole', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const answers = { idea: 'Book a table', remembers: ['Bookings'], wants: [{ text: 'x', from: 'y' }] }
      const plan = { oneLine: 'A booking site.', sessions: [{ name: 'Set up', items: ['a'], mvp: true }] }

      const inserted = insertWorkspaceBrief(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        answers,
        plan,
        brief: 'Build it — the MVP first.',
        createdAt: new Date(),
      })
      expect(inserted.workspaceId).toBe(workspace.id)

      const found = findWorkspaceBriefByWorkspaceId(db, workspace.id)
      expect(found?.answers).toEqual(answers)
      expect(found?.plan).toEqual(plan)
      expect(found?.brief).toBe('Build it — the MVP first.')
      expect(found?.createdAt).toBeInstanceOf(Date)
    })
  })

  it('is null for a workspace without a brief, and refuses a second brief for the same workspace', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      expect(findWorkspaceBriefByWorkspaceId(db, workspace.id)).toBeNull()

      const row = () => ({
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        answers: {},
        plan: {},
        brief: 'x',
        createdAt: new Date(),
      })
      insertWorkspaceBrief(db, row())
      expect(() => insertWorkspaceBrief(db, row())).toThrow()
    })
  })
})
