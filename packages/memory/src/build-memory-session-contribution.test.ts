import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createMemoryEntry } from './create-memory-entry.js'
import {
  buildMemorySessionContribution,
  MEMORY_AGENT_INSTRUCTIONS,
} from './build-memory-session-contribution.js'

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

describe('buildMemorySessionContribution', () => {
  it('returns only the instruction when the workspace has no memory entries', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seed(db)
      expect(buildMemorySessionContribution(db, { workspaceId: workspace.id })).toBe(
        MEMORY_AGENT_INSTRUCTIONS,
      )
    })
  })

  it('renders the snapshot grouped by kind under the instruction', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seed(db)
      createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'person',
        title: 'Sarah Chen',
        body: 'Head of partnerships at Acme.',
        category: 'memory',
        section: 'Key contacts',
        createdSource: 'user-manual',
      })
      createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'preference',
        title: 'Concise',
        body: 'Prefers concise emails.',
        category: 'preferences',
        section: 'Tone',
        createdSource: 'user-manual',
      })

      const block = buildMemorySessionContribution(db, { workspaceId: workspace.id })
      expect(block).toContain(MEMORY_AGENT_INSTRUCTIONS)
      expect(block).toContain('### People')
      expect(block).toContain('Head of partnerships at Acme.')
      expect(block).toContain('### Preferences')
      expect(block).toContain('Prefers concise emails.')
    })
  })
})
