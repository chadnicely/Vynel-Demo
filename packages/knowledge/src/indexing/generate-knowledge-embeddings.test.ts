import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeDocument,
  insertKnowledgeChunks,
  listKnowledgeChunksNeedingEmbedding,
  listKnowledgeChunksForDocument,
} from '@vynel/db/repositories/knowledge'

// Inline FNV-1a + L2-normalized fake (memory's pattern).
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
function inlineFakeEmbedding(text: string): Promise<Buffer> {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, FNV_PRIME) >>> 0
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
  return Promise.resolve(Buffer.from(f.buffer))
}

vi.mock('@vynel/embeddings', () => ({
  EMBEDDING_DIMENSIONS: 384,
  EMBEDDING_BYTES: 1536,
  EMBEDDING_MODEL_VERSION: 'all-MiniLM-L6-v2/v1',
  generateEmbedding: inlineFakeEmbedding,
}))

import { EMBEDDING_MODEL_VERSION } from '@vynel/embeddings'
import { generateKnowledgeEmbeddings } from './generate-knowledge-embeddings.js'

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

function seedChunks(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  count: number,
) {
  const now = new Date()
  const documentId = randomUUID()
  insertKnowledgeDocument(db, {
    id: documentId,
    userId,
    workspaceId,
    relativePath: `doc-${documentId.slice(0, 8)}.md`,
    documentKind: 'markdown',
    contentHash: 'h',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: count,
    parseStatus: 'parsed',
    parseErrorMessage: null,
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  const chunks = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    documentId,
    workspaceId,
    chunkIndex: i,
    startCharOffset: i * 100,
    endCharOffset: i * 100 + 50,
    chunkText: `chunk text ${i}`,
    chunkTokenEstimate: 10,
    embedding: null,
    embeddingModelVersion: null,
    createdAt: now,
  }))
  insertKnowledgeChunks(db, chunks)
  return { documentId, chunks }
}

describe('generateKnowledgeEmbeddings', () => {
  it('picks up unindexed chunks, populates embeddings, returns counts', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedChunks(db, user.id, workspace.id, 3)

      const result = await generateKnowledgeEmbeddings(db)

      expect(result.attempted).toBe(3)
      expect(result.succeeded).toBe(3)
      expect(result.failed).toBe(0)

      // All chunks now have an embedding + model version
      const remaining = listKnowledgeChunksNeedingEmbedding(db)
      expect(remaining).toEqual([])
    })
  })

  it('respects batchSize', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedChunks(db, user.id, workspace.id, 10)

      const result = await generateKnowledgeEmbeddings(db, { batchSize: 4 })

      expect(result.attempted).toBe(4)
      expect(result.succeeded).toBe(4)
      // 6 chunks still unindexed
      expect(listKnowledgeChunksNeedingEmbedding(db)).toHaveLength(6)
    })
  })

  it('writes the embedding column + model version', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const { chunks } = seedChunks(db, user.id, workspace.id, 1)

      await generateKnowledgeEmbeddings(db)

      const updated = listKnowledgeChunksForDocument(db, chunks[0]!.documentId)
      expect(updated[0]!.embedding).toBeInstanceOf(Buffer)
      expect(updated[0]!.embedding!.length).toBe(1536) // 384 × float32
      expect(updated[0]!.embeddingModelVersion).toBe(EMBEDDING_MODEL_VERSION)
    })
  })

  it('returns zero counts when no chunks need embedding', async () => {
    await withTestDatabase(async (db) => {
      seedWorld(db)
      const result = await generateKnowledgeEmbeddings(db)
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 })
    })
  })
})
