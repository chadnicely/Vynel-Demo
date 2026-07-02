import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { setCapabilityEnabled } from './set-capability-enabled.js'
import { listEnabledCapabilities } from './list-enabled-capabilities.js'

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

describe('listEnabledCapabilities', () => {
  it('returns enabled first-party capabilities resolved through the catalog', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: true,
      })
      const enabled = listEnabledCapabilities(db, workspace.id)
      expect(enabled.map((c) => c.id)).toEqual(['memory'])
      expect(enabled[0]!.displayName).toBe('Memory')
    })
  })

  it('excludes disabled capabilities', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: true,
      })
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'knowledge',
        isEnabled: false,
      })
      expect(listEnabledCapabilities(db, workspace.id).map((c) => c.id)).toEqual(['memory'])
    })
  })

  it('skips enabled ids not in the catalog (future marketplace plugin ids)', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'some-marketplace-plugin',
        isEnabled: true,
      })
      expect(listEnabledCapabilities(db, workspace.id)).toEqual([])
    })
  })

  it('returns an empty array for a workspace with no capabilities', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seedUserWorkspace(db)
      expect(listEnabledCapabilities(db, workspace.id)).toEqual([])
    })
  })
})
