// Integration tests for the `knowledge_documents` repository.
// Real SQLite via `withTestDatabase` (per foundation.md §2 row 12).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertKnowledgeSource } from './sources.js'
import type { NewKnowledgeSourceRow } from './sources.js'
import {
  findKnowledgeDocumentBySourcePath as findBySourcePath,
  findKnowledgeDocumentById as findById,
  listKnowledgeDocumentsForWorkspace as listForWorkspace,
  insertKnowledgeDocument as insert,
  updateKnowledgeDocument as update,
  hardDeleteKnowledgeDocument as deleteById,
  markAllKnowledgeDocumentsPendingForWorkspace as markAllPendingForWorkspace,
  getKnowledgeIndexerStatusForWorkspace as getStatusForWorkspace,
  type NewKnowledgeDocumentRow,
} from './documents.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeSource(userId: string, workspaceId: string): NewKnowledgeSourceRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    scope: 'workspace',
    absolutePath: `/tmp/vynel/${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  }
}

function makeDocument(
  userId: string,
  workspaceId: string,
  sourceId: string,
  overrides: Partial<NewKnowledgeDocumentRow> = {},
): NewKnowledgeDocumentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    sourceId,
    scope: 'workspace',
    relativePath: `Files/${randomUUID()}.md`,
    documentKind: 'markdown',
    contentHash: 'abc123',
    fileSizeBytes: 1024,
    fileModifiedAt: now,
    chunkCount: 0,
    parseStatus: 'parsed',
    parseErrorMessage: null,
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// Seed user → workspace → workspace-scoped source; return the ids the tests thread.
function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const user = makeUser()
  insertUser(db, user)
  const ws = makeWorkspace(user.id)
  insertWorkspace(db, ws)
  const source = makeSource(user.id, ws.id)
  insertKnowledgeSource(db, source)
  return { user, ws, source }
}

describe('knowledge_documents repository', () => {
  it('insert — persists a new document row', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id)
      insert(db, doc)
      expect(findById(db, doc.id)?.id).toBe(doc.id)
    })
  })

  it('findBySourcePath — returns the row for (sourceId, relativePath); null when missing', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, { relativePath: 'Files/known.pdf' })
      insert(db, doc)
      expect(findBySourcePath(db, source.id, 'Files/known.pdf')?.id).toBe(doc.id)
      expect(findBySourcePath(db, source.id, 'Files/missing.pdf')).toBeNull()
    })
  })

  it('findById — returns the row by id; null when missing', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id)
      insert(db, doc)
      expect(findById(db, doc.id)?.id).toBe(doc.id)
      expect(findById(db, randomUUID())).toBeNull()
    })
  })

  it('listForWorkspace — returns documents in (indexedAt DESC NULLS LAST, id DESC) order', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const older = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2020, 0, 1) })
      const newer = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2024, 0, 1) })
      const pending = makeDocument(user.id, ws.id, source.id, {
        parseStatus: 'pending',
        indexedAt: null,
      })
      insert(db, older)
      insert(db, newer)
      insert(db, pending)
      const rows = listForWorkspace(db, ws.id)
      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id, pending.id])
    })
  })

  it('listForWorkspace — honors cursor: returns rows AFTER the cursor key', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const a = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2024, 5, 1) })
      const b = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2024, 4, 1) })
      const c = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2024, 3, 1) })
      insert(db, a)
      insert(db, b)
      insert(db, c)
      const after = listForWorkspace(db, ws.id, {
        cursor: { indexedAt: a.indexedAt ?? null, id: a.id },
      })
      expect(after.map((r) => r.id)).toEqual([b.id, c.id])
    })
  })

  it('listForWorkspace — NULLS-LAST: pending rows rank last; cursor crosses into them', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const indexed = makeDocument(user.id, ws.id, source.id, { indexedAt: new Date(2024, 0, 1) })
      const pendingA = makeDocument(user.id, ws.id, source.id, {
        parseStatus: 'pending',
        indexedAt: null,
      })
      const pendingB = makeDocument(user.id, ws.id, source.id, {
        parseStatus: 'pending',
        indexedAt: null,
      })
      insert(db, indexed)
      insert(db, pendingA)
      insert(db, pendingB)
      const allRows = listForWorkspace(db, ws.id)
      expect(allRows[0]!.id).toBe(indexed.id)
      const afterIndexed = listForWorkspace(db, ws.id, {
        cursor: { indexedAt: indexed.indexedAt ?? null, id: indexed.id },
      })
      expect(afterIndexed.length).toBe(2)
      expect(afterIndexed.every((r) => r.parseStatus === 'pending')).toBe(true)
    })
  })

  it('listForWorkspace — documentKind filter restricts results', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      insert(db, makeDocument(user.id, ws.id, source.id, { documentKind: 'pdf' }))
      insert(db, makeDocument(user.id, ws.id, source.id, { documentKind: 'markdown' }))
      insert(db, makeDocument(user.id, ws.id, source.id, { documentKind: 'pdf' }))
      const pdfs = listForWorkspace(db, ws.id, { documentKind: 'pdf' })
      expect(pdfs.length).toBe(2)
      expect(pdfs.every((r) => r.documentKind === 'pdf')).toBe(true)
    })
  })

  it('update — patches parseStatus + chunkCount + indexedAt + updatedAt', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, {
        parseStatus: 'pending',
        chunkCount: 0,
        indexedAt: null,
      })
      insert(db, doc)
      const newIndexed = new Date()
      update(db, doc.id, { parseStatus: 'parsed', chunkCount: 5, indexedAt: newIndexed })
      const row = findById(db, doc.id)!
      expect(row.parseStatus).toBe('parsed')
      expect(row.chunkCount).toBe(5)
      expect(row.indexedAt?.getTime()).toBe(newIndexed.getTime())
    })
  })

  it('deleteById — removes the row', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id)
      insert(db, doc)
      deleteById(db, doc.id)
      expect(findById(db, doc.id)).toBeNull()
    })
  })

  it('markAllPendingForWorkspace — flips every row to parseStatus=pending', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'parsed' }))
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'failed' }))
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'skipped' }))
      markAllPendingForWorkspace(db, ws.id)
      const rows = listForWorkspace(db, ws.id)
      expect(rows.every((r) => r.parseStatus === 'pending')).toBe(true)
    })
  })

  it('getStatusForWorkspace — returns correct counts across the 5 parse states', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      insert(
        db,
        makeDocument(user.id, ws.id, source.id, {
          parseStatus: 'parsed',
          indexedAt: new Date(2024, 0, 1),
        }),
      )
      insert(
        db,
        makeDocument(user.id, ws.id, source.id, {
          parseStatus: 'parsed',
          indexedAt: new Date(2024, 5, 1),
        }),
      )
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'pending', indexedAt: null }))
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'parsing', indexedAt: null }))
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'failed', indexedAt: null }))
      insert(db, makeDocument(user.id, ws.id, source.id, { parseStatus: 'skipped', indexedAt: null }))
      const status = getStatusForWorkspace(db, ws.id)
      expect(status.totalDocuments).toBe(6)
      expect(status.parsedDocuments).toBe(2)
      expect(status.pendingDocuments).toBe(1)
      expect(status.parsingDocuments).toBe(1)
      expect(status.failedDocuments).toBe(1)
      expect(status.skippedDocuments).toBe(1)
      expect(status.lastIndexedAt?.getTime()).toBe(new Date(2024, 5, 1).getTime())
    })
  })
})
