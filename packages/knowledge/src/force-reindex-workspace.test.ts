import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listKnowledgeDocumentsForWorkspace } from '@vynel/db/repositories/knowledge'
import { indexWorkspace } from './index-workspace.js'
import { forceReindexWorkspace } from './force-reindex-workspace.js'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-force-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

function seedUserWorkspace(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspaceLocation: string,
) {
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
    path: workspaceLocation,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

describe('forceReindexWorkspace', () => {
  it('flips all rows to pending then re-indexes them', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db, workspacePath)
      await writeFile(path.join(workspacePath, 'a.md'), '# A', 'utf8')
      await writeFile(path.join(workspacePath, 'b.md'), '# B', 'utf8')

      // First pass — establish parsed state
      await indexWorkspace(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
      })
      const beforeRows = listKnowledgeDocumentsForWorkspace(db, workspace.id, { limit: 50 })
      expect(beforeRows.every((d) => d.parseStatus === 'parsed')).toBe(true)

      // Force re-index — verify counts come back parsed again
      const result = await forceReindexWorkspace(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
      })

      expect(result.indexedCount).toBe(2)
      expect(result.skippedCount).toBe(0)
      expect(result.failedCount).toBe(0)

      const afterRows = listKnowledgeDocumentsForWorkspace(db, workspace.id, { limit: 50 })
      expect(afterRows.every((d) => d.parseStatus === 'parsed')).toBe(true)
      // Same row IDs — force-reindex updates in place, doesn't replace
      expect(new Set(afterRows.map((d) => d.id))).toEqual(new Set(beforeRows.map((d) => d.id)))
    })
  })
})
