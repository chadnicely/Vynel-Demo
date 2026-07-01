import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertKnowledgeDocument } from '@vynel/db/repositories/knowledge'
import { listDocumentsForWorkspace } from './list-documents-for-workspace.js'

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

function insertDoc(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  relativePath: string,
  indexedAt: Date | null,
  documentKind: 'markdown' | 'plain-text' = 'markdown',
) {
  const now = new Date()
  const id = randomUUID()
  insertKnowledgeDocument(db, {
    id,
    userId,
    workspaceId,
    relativePath,
    documentKind,
    contentHash: 'h',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: 0,
    parseStatus: indexedAt ? 'parsed' : 'pending',
    parseErrorMessage: null,
    indexedAt,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('listDocumentsForWorkspace', () => {
  it('returns documents with null nextCursor when under the limit', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      insertDoc(db, user.id, workspace.id, 'a.md', new Date('2026-05-25T10:00:00Z'))
      insertDoc(db, user.id, workspace.id, 'b.md', new Date('2026-05-25T11:00:00Z'))

      const result = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        limit: 10,
      })
      expect(result.documents).toHaveLength(2)
      expect(result.nextCursor).toBeNull()
    })
  })

  it('returns a nextCursor when the page is full + iterates correctly', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const baseTime = new Date('2026-05-25T10:00:00Z').getTime()
      for (let i = 0; i < 5; i++) {
        insertDoc(db, user.id, workspace.id, `doc-${i}.md`, new Date(baseTime + i * 1000))
      }

      const page1 = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        limit: 3,
      })
      expect(page1.documents).toHaveLength(3)
      expect(page1.nextCursor).not.toBeNull()
      expect(typeof page1.nextCursor!.indexedAt).toBe('string')

      const page2 = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        limit: 3,
        cursor: page1.nextCursor!,
      })
      expect(page2.documents.length).toBeGreaterThan(0)
      // No overlap with page 1
      const ids1 = new Set(page1.documents.map((d) => d.id))
      expect(page2.documents.every((d) => !ids1.has(d.id))).toBe(true)
    })
  })

  it('crosses the NULL boundary when paginating into not-yet-indexed rows', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      // 2 indexed + 2 not-yet-indexed
      insertDoc(db, user.id, workspace.id, 'idx-1.md', new Date('2026-05-25T10:00:00Z'))
      insertDoc(db, user.id, workspace.id, 'idx-2.md', new Date('2026-05-25T11:00:00Z'))
      insertDoc(db, user.id, workspace.id, 'pending-1.md', null)
      insertDoc(db, user.id, workspace.id, 'pending-2.md', null)

      const page1 = listDocumentsForWorkspace(db, { workspaceId: workspace.id, limit: 2 })
      expect(page1.documents).toHaveLength(2)
      expect(page1.documents.every((d) => d.indexedAt !== null)).toBe(true)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        limit: 10,
        cursor: page1.nextCursor!,
      })
      // The NULL tail comes next
      expect(page2.documents.length).toBe(2)
      expect(page2.documents.every((d) => d.indexedAt === null)).toBe(true)
    })
  })

  it('returns the single matching document when an exact path is provided', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      insertDoc(db, user.id, workspace.id, 'a.md', new Date('2026-05-25T10:00:00Z'))
      insertDoc(db, user.id, workspace.id, 'notes/b.md', new Date('2026-05-25T11:00:00Z'))

      const found = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        path: 'notes/b.md',
      })
      expect(found.documents).toHaveLength(1)
      expect(found.documents[0]!.relativePath).toBe('notes/b.md')
      expect(found.nextCursor).toBeNull()
    })
  })

  it('returns an empty list when the path matches no document', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      insertDoc(db, user.id, workspace.id, 'a.md', new Date('2026-05-25T10:00:00Z'))

      const result = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        path: 'never-indexed.md',
      })
      expect(result.documents).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })

  it('filters by documentKind when provided', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      insertDoc(db, user.id, workspace.id, 'a.md', new Date(), 'markdown')
      insertDoc(db, user.id, workspace.id, 'b.txt', new Date(), 'plain-text')

      const onlyMd = listDocumentsForWorkspace(db, {
        workspaceId: workspace.id,
        documentKind: 'markdown',
      })
      expect(onlyMd.documents).toHaveLength(1)
      expect(onlyMd.documents[0]!.documentKind).toBe('markdown')
    })
  })
})
