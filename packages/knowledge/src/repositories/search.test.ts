// Integration tests for the knowledge search repository.
// Real SQLite + sqlite-vec via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertKnowledgeSource } from './sources.js'
import type { NewKnowledgeSourceRow } from './sources.js'
import {
  insertKnowledgeDocument as insertDocument,
  type NewKnowledgeDocumentRow,
} from './documents.js'
import { insertKnowledgeChunks as insertChunks } from './chunks.js'
import {
  searchKnowledgeChunks,
  upsertVectorIndexForChunk,
  deleteVectorIndexForDocument,
} from './search.js'

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

function makeDocument(
  userId: string,
  workspaceId: string,
  sourceId: string,
  relativePath: string,
  documentKind: 'markdown' | 'pdf' | 'plain-text' = 'markdown',
): NewKnowledgeDocumentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    sourceId,
    scope: 'workspace',
    relativePath,
    documentKind,
    contentHash: 'h',
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

function makeChunk(documentId: string, chunkIndex: number, chunkText: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    documentId,
    chunkIndex,
    startCharOffset: 0,
    endCharOffset: chunkText.length,
    chunkText,
    chunkTokenEstimate: Math.ceil(chunkText.length / 4),
    embedding: null,
    embeddingModelVersion: null,
    createdAt: now,
  }
}

// Deterministic fake embedding — FNV-1a + L2-normalized 384-dim float32.
function fakeEmbedding(text: string): Buffer {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let state = h || 1
  const f = new Float32Array(384)
  for (let i = 0; i < 384; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    f[i] = (state / 0xffffffff) * 2 - 1
  }
  let sumSq = 0
  for (let i = 0; i < f.length; i++) sumSq += f[i]! * f[i]!
  const norm = Math.sqrt(sumSq) || 1
  for (let i = 0; i < f.length; i++) f[i]! /= norm
  return Buffer.from(f.buffer)
}

// user → workspace → workspace source; returns ids the tests thread.
function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const user = makeUser()
  insertUser(db, user)
  const ws = makeWorkspace(user.id)
  insertWorkspace(db, ws)
  const source = makeSource(user.id, ws.id)
  insertKnowledgeSource(db, source)
  return { user, ws, source }
}

describe('knowledge search repository', () => {
  it('searchKnowledgeChunks (fts) — returns chunks matching the FTS5 query', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, 'Files/contract.md')
      insertDocument(db, doc)
      insertChunks(db, [
        makeChunk(doc.id, 0, 'The tomato suppliers in Italy ship weekly.'),
        makeChunk(doc.id, 1, 'Refrigerated trucks handle the cold chain.'),
      ])
      const hits = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        textQuery: 'tomato',
        mode: 'fts',
      })
      expect(hits.length).toBe(1)
      expect(hits[0]!.documentId).toBe(doc.id)
      expect(hits[0]!.chunkText).toContain('<mark>')
    })
  })

  it('searchKnowledgeChunks (semantic) — returns chunks ranked by cosine distance', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, 'Files/notes.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, 0, 'first chunk text')
      const c2 = makeChunk(doc.id, 1, 'second chunk text')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('first'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('second'),
      })
      const hits = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        embeddingQuery: fakeEmbedding('first'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.chunkId).toBe(c1.id)
    })
  })

  it('searchKnowledgeChunks (hybrid) — combines fts + semantic via RRF', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, 'Files/notes.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, 0, 'tomato suppliers in Italy')
      const c2 = makeChunk(doc.id, 1, 'cold chain logistics overview')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('tomato suppliers'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('cold chain'),
      })
      const hits = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        textQuery: 'tomato',
        embeddingQuery: fakeEmbedding('tomato suppliers'),
        mode: 'hybrid',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.chunkId).toBe(c1.id)
    })
  })

  it('searchKnowledgeChunks — sourceIds restricts to the given sources (fuses only in-scope)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const wsA = makeWorkspace(user.id)
      const wsB = makeWorkspace(user.id)
      insertWorkspace(db, wsA)
      insertWorkspace(db, wsB)
      const srcA = makeSource(user.id, wsA.id)
      const srcB = makeSource(user.id, wsB.id)
      insertKnowledgeSource(db, srcA)
      insertKnowledgeSource(db, srcB)
      const docA = makeDocument(user.id, wsA.id, srcA.id, 'A.md')
      const docB = makeDocument(user.id, wsB.id, srcB.id, 'B.md')
      insertDocument(db, docA)
      insertDocument(db, docB)
      insertChunks(db, [
        makeChunk(docA.id, 0, 'tomato in source A'),
        makeChunk(docB.id, 0, 'tomato in source B'),
      ])
      const hitsA = searchKnowledgeChunks(db, {
        sourceIds: [srcA.id],
        textQuery: 'tomato',
        mode: 'fts',
      })
      expect(hitsA.length).toBe(1)
      expect(hitsA[0]!.chunkText).toContain('A')
    })
  })

  it('searchKnowledgeChunks — documentKindFilter restricts results', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const pdf = makeDocument(user.id, ws.id, source.id, 'contract.pdf', 'pdf')
      const md = makeDocument(user.id, ws.id, source.id, 'notes.md', 'markdown')
      insertDocument(db, pdf)
      insertDocument(db, md)
      insertChunks(db, [makeChunk(pdf.id, 0, 'tomato in pdf'), makeChunk(md.id, 0, 'tomato in markdown')])
      const pdfOnly = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        textQuery: 'tomato',
        mode: 'fts',
        documentKindFilter: ['pdf'],
      })
      expect(pdfOnly.length).toBe(1)
      expect(pdfOnly[0]!.documentKind).toBe('pdf')
    })
  })

  it('upsertVectorIndexForChunk — first call INSERTs; second call DELETE+INSERTs', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, 'A.md')
      insertDocument(db, doc)
      const c = makeChunk(doc.id, 0, 'text')
      insertChunks(db, [c])
      upsertVectorIndexForChunk(db, {
        chunkId: c.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('v1'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('v2'),
      })
      const hits = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        embeddingQuery: fakeEmbedding('v2'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
    })
  })

  it('deleteVectorIndexForDocument — purges all vec rows for the given documentId', async () => {
    await withTestDatabase(async (db) => {
      const { user, ws, source } = seed(db)
      const doc = makeDocument(user.id, ws.id, source.id, 'A.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, 0, 'x')
      const c2 = makeChunk(doc.id, 1, 'y')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('x'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        sourceId: source.id,
        documentId: doc.id,
        embedding: fakeEmbedding('y'),
      })
      deleteVectorIndexForDocument(db, doc.id)
      const hits = searchKnowledgeChunks(db, {
        sourceIds: [source.id],
        embeddingQuery: fakeEmbedding('x'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBe(0)
    })
  })
})
