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
  // test: correct expectation — first-party capabilities now default ON with
  // no row (was: all off). Same resolution as listEnabledCapabilities, so the
  // panel can never show "off" while the session composes the capability in.
  it('returns every catalog capability, enabled by default (no rows)', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seed(db)
      const statuses = listCapabilityStatusForWorkspace(db, workspace.id)
      // test: correct expectation — the catalog grew: 'phases' + 'features'
      // joined as defaultEnabled first-party capabilities (engineering-plan
      // modules, 2026-08-11; 'plans'/'journal'/'tasks' before them).
      expect(statuses.map((s) => s.capability.id).sort()).toEqual([
        'features',
        'journal',
        'knowledge',
        'memory',
        'notebook',
        'phases',
        'plans',
        'tasks',
      ])
      expect(statuses.every((s) => s.isEnabled)).toBe(true)
    })
  })

  it('reflects an explicit disable while leaving the others on', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seed(db)
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: false,
      })
      const statuses = listCapabilityStatusForWorkspace(db, workspace.id)
      expect(statuses.find((s) => s.capability.id === 'memory')?.isEnabled).toBe(false)
      expect(statuses.find((s) => s.capability.id === 'knowledge')?.isEnabled).toBe(true)
    })
  })
})
