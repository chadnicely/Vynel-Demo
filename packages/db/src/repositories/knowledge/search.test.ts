// Integration tests for the knowledge search repository.
// Real SQLite + sqlite-vec via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertKnowledgeDocument as insertDocument } from './documents.js'
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

function makeDocument(
  userId: string,
  workspaceId: string,
  relativePath: string,
  documentKind: 'markdown' | 'pdf' | 'plain-text' = 'markdown',
) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    relativePath,
    documentKind,
    contentHash: 'h',
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

function makeChunk(documentId: string, workspaceId: string, chunkIndex: number, chunkText: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    documentId,
    workspaceId,
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
// Same shape memory's tests use.
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

describe('knowledge search repository', () => {
  it('searchKnowledgeChunks (fts) — returns chunks matching the FTS5 query', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id, 'Files/contract.md')
      insertDocument(db, doc)
      insertChunks(db, [
        makeChunk(doc.id, ws.id, 0, 'The tomato suppliers in Italy ship weekly.'),
        makeChunk(doc.id, ws.id, 1, 'Refrigerated trucks handle the cold chain.'),
      ])
      const hits = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
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
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id, 'Files/notes.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, ws.id, 0, 'first chunk text')
      const c2 = makeChunk(doc.id, ws.id, 1, 'second chunk text')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('first'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('second'),
      })
      const hits = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
        embeddingQuery: fakeEmbedding('first'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
      // The first chunk's exact match should rank highest
      expect(hits[0]!.chunkId).toBe(c1.id)
    })
  })

  it('searchKnowledgeChunks (hybrid) — combines fts + semantic via RRF', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id, 'Files/notes.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, ws.id, 0, 'tomato suppliers in Italy')
      const c2 = makeChunk(doc.id, ws.id, 1, 'cold chain logistics overview')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('tomato suppliers'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('cold chain'),
      })
      const hits = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
        textQuery: 'tomato',
        embeddingQuery: fakeEmbedding('tomato suppliers'),
        mode: 'hybrid',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
      // c1 should win — both FTS + semantic hit
      expect(hits[0]!.chunkId).toBe(c1.id)
    })
  })

  it('searchKnowledgeChunks — workspaceId filter restricts to active workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const wsA = makeWorkspace(user.id)
      const wsB = makeWorkspace(user.id)
      insertWorkspace(db, wsA)
      insertWorkspace(db, wsB)
      const docA = makeDocument(user.id, wsA.id, 'A.md')
      const docB = makeDocument(user.id, wsB.id, 'B.md')
      insertDocument(db, docA)
      insertDocument(db, docB)
      insertChunks(db, [
        makeChunk(docA.id, wsA.id, 0, 'tomato in workspace A'),
        makeChunk(docB.id, wsB.id, 0, 'tomato in workspace B'),
      ])
      const hitsA = searchKnowledgeChunks(db, {
        workspaceId: wsA.id,
        textQuery: 'tomato',
        mode: 'fts',
      })
      expect(hitsA.length).toBe(1)
      expect(hitsA[0]!.chunkText).toContain('A')
    })
  })

  it('searchKnowledgeChunks — documentKindFilter restricts results', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const pdf = makeDocument(user.id, ws.id, 'contract.pdf', 'pdf')
      const md = makeDocument(user.id, ws.id, 'notes.md', 'markdown')
      insertDocument(db, pdf)
      insertDocument(db, md)
      insertChunks(db, [
        makeChunk(pdf.id, ws.id, 0, 'tomato in pdf'),
        makeChunk(md.id, ws.id, 0, 'tomato in markdown'),
      ])
      const pdfOnly = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
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
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id, 'A.md')
      insertDocument(db, doc)
      const c = makeChunk(doc.id, ws.id, 0, 'text')
      insertChunks(db, [c])
      upsertVectorIndexForChunk(db, {
        chunkId: c.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('v1'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('v2'),
      })
      // No throw on the second upsert (vec0 upsert pattern works)
      const hits = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
        embeddingQuery: fakeEmbedding('v2'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
    })
  })

  it('deleteVectorIndexForDocument — purges all vec rows for the given documentId', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const doc = makeDocument(user.id, ws.id, 'A.md')
      insertDocument(db, doc)
      const c1 = makeChunk(doc.id, ws.id, 0, 'x')
      const c2 = makeChunk(doc.id, ws.id, 1, 'y')
      insertChunks(db, [c1, c2])
      upsertVectorIndexForChunk(db, {
        chunkId: c1.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('x'),
      })
      upsertVectorIndexForChunk(db, {
        chunkId: c2.id,
        workspaceId: ws.id,
        documentId: doc.id,
        embedding: fakeEmbedding('y'),
      })
      deleteVectorIndexForDocument(db, doc.id)
      // After deletion, no semantic hits for the document
      const hits = searchKnowledgeChunks(db, {
        workspaceId: ws.id,
        embeddingQuery: fakeEmbedding('x'),
        mode: 'semantic',
        limit: 5,
      })
      expect(hits.length).toBe(0)
    })
  })
})
