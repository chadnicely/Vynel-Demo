import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createMemoryEntry } from '../lifecycle/create-memory-entry.js'
import { CONTEXT_MEMORY_TAG, DEFAULT_MEMORY_TAGS } from '../memory-tags.js'
import { listMemoryTags } from './list-memory-tags.js'

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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

describe('listMemoryTags', () => {
  it('merges in-use tags with the defaults, context always first', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'Vendor list lives in the shared drive.',
        category: 'memory',
        section: 'ops',
        createdSource: 'user-manual',
        tags: ['vendors', CONTEXT_MEMORY_TAG],
      })

      const tags = listMemoryTags(db, { workspaceId: workspace.id })
      expect(tags[0]).toBe(CONTEXT_MEMORY_TAG)
      expect(tags).toContain('vendors')
      for (const suggested of DEFAULT_MEMORY_TAGS) expect(tags).toContain(suggested)
      // No duplicates.
      expect(new Set(tags).size).toBe(tags.length)
    })
  })
})
