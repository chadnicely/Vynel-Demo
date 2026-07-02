import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { setCapabilityEnabled } from './set-capability-enabled.js'
import { listCapabilityStatusForWorkspace } from './list-capability-status.js'

function seed(db: Database) {
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

describe('listCapabilityStatusForWorkspace', () => {
  it('returns every catalog capability, all disabled by default', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seed(db)
      const statuses = listCapabilityStatusForWorkspace(db, workspace.id)
      expect(statuses.map((s) => s.capability.id).sort()).toEqual(['knowledge', 'memory'])
      expect(statuses.every((s) => !s.isEnabled)).toBe(true)
    })
  })

  it('reflects an enabled capability while leaving the others off', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seed(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: true,
      })
      const statuses = listCapabilityStatusForWorkspace(db, workspace.id)
      expect(statuses.find((s) => s.capability.id === 'memory')?.isEnabled).toBe(true)
      expect(statuses.find((s) => s.capability.id === 'knowledge')?.isEnabled).toBe(false)
    })
  })
})
