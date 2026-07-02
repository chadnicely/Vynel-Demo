import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findWorkspaceCapability } from '@vynel/db/repositories/capabilities'
import { setCapabilityEnabled } from './set-capability-enabled.js'

function seedUserWorkspace(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
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
  return { user, workspace }
}

describe('setCapabilityEnabled', () => {
  it('inserts a new enable row on the first toggle', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      const row = setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: true,
      })
      expect(row.isEnabled).toBe(true)
      expect(row.capabilityId).toBe('memory')
    })
  })

  it('updates the existing row on subsequent toggles (no duplicate)', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      const base = { userId: user.id, workspaceId: workspace.id, capabilityId: 'memory' }
      const first = setCapabilityEnabled(db, { ...base, isEnabled: true })
      const second = setCapabilityEnabled(db, { ...base, isEnabled: false })
      expect(second.id).toBe(first.id)
      expect(second.isEnabled).toBe(false)
      expect(
        findWorkspaceCapability(db, { workspaceId: workspace.id, capabilityId: 'memory' })?.isEnabled,
      ).toBe(false)
    })
  })
})
