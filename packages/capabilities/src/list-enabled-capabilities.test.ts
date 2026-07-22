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
  // test: correct expectation for no-row workspaces — first-party capabilities
  // now DEFAULT ON (a row is an explicit toggle override); was: empty. Nothing
  // seeds rows at workspace creation, so the old default meant memory +
  // knowledge were silently off everywhere (2026-07-11 live catch).
  it('defaults first-party capabilities ON for a workspace with no rows', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seedUserWorkspace(db)
      const enabled = listEnabledCapabilities(db, workspace.id)
      // test: correct expectation — the catalog grew: 'plans' + 'journal'
      // joined as defaultEnabled first-party capabilities (plans/journal
      // modules, 2026-07-23; 'tasks' before them).
      expect(enabled.map((c) => c.id).sort()).toEqual([
        'journal',
        'knowledge',
        'memory',
        'notebook',
        'plans',
        'tasks',
      ])
    })
  })

  it('an explicit disable row overrides the default', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'knowledge',
        isEnabled: false,
      })
      expect(listEnabledCapabilities(db, workspace.id).map((c) => c.id).sort()).toEqual([
        'journal',
        'memory',
        'notebook',
        'plans',
        'tasks',
      ])
    })
  })

  it('an explicit re-enable row restores a disabled capability', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserWorkspace(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: false,
      })
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: true,
      })
      const enabled = listEnabledCapabilities(db, workspace.id)
      expect(enabled.map((c) => c.id).sort()).toEqual([
        'journal',
        'knowledge',
        'memory',
        'notebook',
        'plans',
        'tasks',
      ])
      expect(enabled.find((c) => c.id === 'memory')!.displayName).toBe('Memory')
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
      // Catalog capabilities resolve by default; the unknown plugin id is skipped.
      expect(listEnabledCapabilities(db, workspace.id).map((c) => c.id).sort()).toEqual([
        'journal',
        'knowledge',
        'memory',
        'notebook',
        'plans',
        'tasks',
      ])
    })
  })
})
