// Integration tests for the `knowledge_chunks` repository.
// Real SQLite via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertKnowledgeDocument as insertDocument } from './documents.js'
import {
  insertKnowledgeChunks as insertMany,
  hardDeleteKnowledgeChunksForDocument as deleteForDocument,
  listKnowledgeChunksForDocument as listForDocument,
  listKnowledgeChunksNeedingEmbedding as listNeedingEmbedding,
  updateKnowledgeChunkEmbedding as updateEmbedding,
  countUnindexedKnowledgeChunksForWorkspace as countUnindexedChunksForWorkspace,
  type NewKnowledgeChunkRow,
} from './chunks.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test',
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

function makeDocument(userId: string, workspaceId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    relativePath: `Files/${randomUUID()}.md`,
    documentKind: 'markdown' as const,
    contentHash: 'hash',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: 0,
    parseStatus: 'parsed' as const,
    parseErrorMessage: null,
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function makeChunk(
  documentId: string,
  workspaceId: string,
  overrides: Partial<NewKnowledgeChunkRow> = {},
): NewKnowledgeChunkRow {
  const now = new Date()
  return {
    id: randomUUID(),
    documentId,
    workspaceId,
    chunkIndex: 0,
    startCharOffset: 0,
    endCharOffset: 100,
    chunkText: 'hello world',
    chunkTokenEstimate: 25,
    embedding: null,
    embeddingModelVersion: null,
    createdAt: now,
    ...overrides,
  }
}

describe('knowledge_chunks repository', () => {
  it('insertMany — persists multiple chunks atomically for one document', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [
        makeChunk(doc.id, ws.id, { chunkIndex: 0, chunkText: 'first' }),
        makeChunk(doc.id, ws.id, { chunkIndex: 1, chunkText: 'second' }),
      ])
      expect(listForDocument(db, doc.id)).toHaveLength(2)
    })
  })

  it('deleteForDocument — removes all chunks for the given documentId', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [
        makeChunk(doc.id, ws.id, { chunkIndex: 0 }),
        makeChunk(doc.id, ws.id, { chunkIndex: 1 }),
      ])
      deleteForDocument(db, doc.id)
      expect(listForDocument(db, doc.id)).toHaveLength(0)
    })
  })

  it('listForDocument — returns chunks in chunkIndex ASC order', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [
        makeChunk(doc.id, ws.id, { chunkIndex: 2 }),
        makeChunk(doc.id, ws.id, { chunkIndex: 0 }),
        makeChunk(doc.id, ws.id, { chunkIndex: 1 }),
      ])
      const rows = listForDocument(db, doc.id)
      expect(rows.map((r) => r.chunkIndex)).toEqual([0, 1, 2])
    })
  })

  it('listNeedingEmbedding — excludes rows with non-null embedding', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [
        makeChunk(doc.id, ws.id, { chunkIndex: 0, embedding: null }),
        makeChunk(doc.id, ws.id, { chunkIndex: 1, embedding: Buffer.alloc(1536) }),
      ])
      const need = listNeedingEmbedding(db)
      expect(need).toHaveLength(1)
      expect(need[0]!.chunkIndex).toBe(0)
    })
  })

  it('listNeedingEmbedding — honors limit', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      const chunks = Array.from({ length: 10 }).map((_, i) =>
        makeChunk(doc.id, ws.id, { chunkIndex: i }),
      )
      insertMany(db, chunks)
      expect(listNeedingEmbedding(db, { limit: 3 })).toHaveLength(3)
    })
  })

  it('updateEmbedding — sets embedding + embeddingModelVersion', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      const chunk = makeChunk(doc.id, ws.id)
      insertMany(db, [chunk])
      const buf = Buffer.alloc(1536, 0xab)
      updateEmbedding(db, chunk.id, buf, 'all-MiniLM-L6-v2/v1')
      const [row] = listForDocument(db, doc.id)
      expect(row!.embedding).toEqual(buf)
      expect(row!.embeddingModelVersion).toBe('all-MiniLM-L6-v2/v1')
    })
  })

  it('FK cascade — deleting parent knowledge_documents row removes chunks', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [makeChunk(doc.id, ws.id), makeChunk(doc.id, ws.id, { chunkIndex: 1 })])
      const { hardDeleteKnowledgeDocument } = await import('./documents.js')
      hardDeleteKnowledgeDocument(db, doc.id)
      expect(listForDocument(db, doc.id)).toHaveLength(0)
    })
  })

  it('countUnindexedChunksForWorkspace — counts only null-embedding rows in the workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id)
      insertDocument(db, doc)
      insertMany(db, [
        makeChunk(doc.id, ws.id, { chunkIndex: 0, embedding: null }),
        makeChunk(doc.id, ws.id, { chunkIndex: 1, embedding: null }),
        makeChunk(doc.id, ws.id, { chunkIndex: 2, embedding: Buffer.alloc(1536) }),
      ])
      expect(countUnindexedChunksForWorkspace(db, ws.id)).toBe(2)
    })
  })
})
