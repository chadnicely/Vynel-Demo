// Integration tests for the `knowledge_chunks` repository.
// Real SQLite via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertKnowledgeSource } from './sources.js'
import type { NewKnowledgeSourceRow } from './sources.js'
import {
  insertKnowledgeDocument as insertDocument,
  type NewKnowledgeDocumentRow,
} from './documents.js'
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

function makeDocument(userId: string, workspaceId: string, sourceId: string): NewKnowledgeDocumentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    sourceId,
    scope: 'workspace',
    relativePath: `Files/${randomUUID()}.md`,
    documentKind: 'markdown',
    contentHash: 'hash',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: 0,
    parseStatus: 'parsed',
    parseErrorMessage: null,
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function makeChunk(documentId: string, overrides: Partial<NewKnowledgeChunkRow> = {}): NewKnowledgeChunkRow {
  const now = new Date()
  return {
    id: randomUUID(),
    documentId,
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

// user → workspace → workspace source → document; returns ids the tests thread.
function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const user = makeUser()
  insertUser(db, user)
  const ws = makeWorkspace(user.id)
  insertWorkspace(db, ws)
  const source = makeSource(user.id, ws.id)
  insertKnowledgeSource(db, source)
  const doc = makeDocument(user.id, ws.id, source.id)
  insertDocument(db, doc)
  return { user, ws, source, doc }
}

describe('knowledge_chunks repository', () => {
  it('insertMany — persists multiple chunks atomically for one document', async () => {
    await withTestDatabase(async (db) => {
      const { doc } = seed(db)
      insertMany(db, [
        makeChunk(doc.id, { chunkIndex: 0, chunkText: 'first' }),
        makeChunk(doc.id, { chunkIndex: 1, chunkText: 'second' }),
      ])
      expect(listForDocument(db, doc.id)).toHaveLength(2)
    })
  })

  it('deleteForDocument — removes all chunks for the given documentId', async () => {
    await withTestDatabase(async (db) => {
      const { doc } = seed(db)
      insertMany(db, [makeChunk(doc.id, { chunkIndex: 0 }), makeChunk(doc.id, { chunkIndex: 1 })])
      deleteForDocument(db, doc.id)
      expect(listForDocument(db, doc.id)).toHaveLength(0)
    })
  })

  it('listForDocument — returns chunks in chunkIndex ASC order', async () => {
    await withTestDatabase(async (db) => {
      const { doc } = seed(db)
      insertMany(db, [
        makeChunk(doc.id, { chunkIndex: 2 }),
        makeChunk(doc.id, { chunkIndex: 0 }),
        makeChunk(doc.id, { chunkIndex: 1 }),
      ])
      const rows = listForDocument(db, doc.id)
      expect(rows.map((r) => r.chunkIndex)).toEqual([0, 1, 2])
    })
  })

  it('listNeedingEmbedding — excludes rows with non-null embedding; returns {chunk, sourceId}', async () => {
    await withTestDatabase(async (db) => {
      const { doc, source } = seed(db)
      insertMany(db, [
        makeChunk(doc.id, { chunkIndex: 0, embedding: null }),
        makeChunk(doc.id, { chunkIndex: 1, embedding: Buffer.alloc(1536) }),
      ])
      const need = listNeedingEmbedding(db)
      expect(need).toHaveLength(1)
      expect(need[0]!.chunk.chunkIndex).toBe(0)
      expect(need[0]!.sourceId).toBe(source.id)
    })
  })

  it('listNeedingEmbedding — honors limit', async () => {
    await withTestDatabase(async (db) => {
      const { doc } = seed(db)
      const chunks = Array.from({ length: 10 }).map((_, i) => makeChunk(doc.id, { chunkIndex: i }))
      insertMany(db, chunks)
      expect(listNeedingEmbedding(db, { limit: 3 })).toHaveLength(3)
    })
  })

  it('updateEmbedding — sets embedding + embeddingModelVersion', async () => {
    await withTestDatabase(async (db) => {
      const { doc } = seed(db)
      const chunk = makeChunk(doc.id)
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
      const { doc } = seed(db)
      insertMany(db, [makeChunk(doc.id), makeChunk(doc.id, { chunkIndex: 1 })])
      const { hardDeleteKnowledgeDocument } = await import('./documents.js')
      hardDeleteKnowledgeDocument(db, doc.id)
      expect(listForDocument(db, doc.id)).toHaveLength(0)
    })
  })

  it('countUnindexedChunksForWorkspace — counts only null-embedding rows in the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { ws, doc } = seed(db)
      insertMany(db, [
        makeChunk(doc.id, { chunkIndex: 0, embedding: null }),
        makeChunk(doc.id, { chunkIndex: 1, embedding: null }),
        makeChunk(doc.id, { chunkIndex: 2, embedding: Buffer.alloc(1536) }),
      ])
      expect(countUnindexedChunksForWorkspace(db, ws.id)).toBe(2)
    })
  })
})
