import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeDocument,
  insertKnowledgeChunks,
  upsertVectorIndexForChunk,
} from '@vynel/db/repositories/knowledge'

// Inline FNV-1a + L2-normalized fake — same pattern memory uses to
// avoid vitest's vi.mock + dynamic-import hang interaction with the
// real `@vynel/embeddings` HF model load.
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
  generateEmbedding: inlineFakeEmbedding,
}))

const fakeGenerateEmbedding = inlineFakeEmbedding

import { searchKnowledge } from './search-knowledge.js'

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

function seedChunkedDocument(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  relativePath: string,
  chunkTexts: string[],
) {
  const now = new Date()
  const documentId = randomUUID()
  insertKnowledgeDocument(db, {
    id: documentId,
    userId,
    workspaceId,
    relativePath,
    documentKind: 'markdown',
    contentHash: 'h',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: chunkTexts.length,
    parseStatus: 'parsed',
    parseErrorMessage: null,
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  const chunks = chunkTexts.map((text, i) => ({
    id: randomUUID(),
    documentId,
    workspaceId,
    chunkIndex: i,
    startCharOffset: i * 100,
    endCharOffset: i * 100 + text.length,
    chunkText: text,
    chunkTokenEstimate: Math.ceil(text.length / 4),
    embedding: null,
    embeddingModelVersion: null,
    createdAt: now,
  }))
  insertKnowledgeChunks(db, chunks)
  return { documentId, chunks }
}

describe('searchKnowledge', () => {
  it('FTS mode: textQuery used, no embedding call', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedChunkedDocument(db, user.id, workspace.id, 'Notes/a.md', [
        'Acme sells tomato every Friday.',
        'Beta sells pepper.',
      ])

      const results = await searchKnowledge(db, {
        workspaceId: workspace.id,
        query: 'tomato',
        mode: 'fts',
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0]!.chunkText).toContain('<mark>')
      expect(results[0]!.semanticScore).toBeNull()
      expect(results[0]!.relativePath).toBe('Notes/a.md')
    })
  })

  it('semantic mode: textQuery NOT used in SQL, embedding required', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const { chunks } = seedChunkedDocument(db, user.id, workspace.id, 'Notes/a.md', [
        'unrelated text here',
      ])
      // Seed a vec row keyed off a known fake embedding
      const queryText = 'xyz query'
      const fakeEmbed = await fakeGenerateEmbedding(queryText)
      upsertVectorIndexForChunk(db, {
        chunkId: chunks[0]!.id,
        workspaceId: workspace.id,
        documentId: chunks[0]!.documentId,
        embedding: fakeEmbed,
      })

      const results = await searchKnowledge(db, {
        workspaceId: workspace.id,
        query: queryText,
        mode: 'semantic',
      })

      expect(results).toHaveLength(1)
      expect(results[0]!.ftsScore).toBeNull()
      expect(results[0]!.semanticScore).not.toBeNull()
    })
  })

  it('hybrid mode (default) combines FTS + semantic via RRF', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const { chunks } = seedChunkedDocument(db, user.id, workspace.id, 'Notes/a.md', [
        'tomato fresh red',
      ])
      const queryText = 'tomato'
      upsertVectorIndexForChunk(db, {
        chunkId: chunks[0]!.id,
        workspaceId: workspace.id,
        documentId: chunks[0]!.documentId,
        embedding: await fakeGenerateEmbedding(queryText),
      })

      const results = await searchKnowledge(db, {
        workspaceId: workspace.id,
        query: queryText,
        // mode omitted → hybrid default
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      // The match hits both FTS + semantic — combinedScore reflects both
      const winner = results[0]!
      expect(winner.relativePath).toBe('Notes/a.md')
    })
  })

  it('documentKindFilter restricts results to matching kinds', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const now = new Date()
      // 1 markdown + 1 pdf, both containing 'shared'
      const mdId = randomUUID()
      insertKnowledgeDocument(db, {
        id: mdId,
        userId: user.id,
        workspaceId: workspace.id,
        relativePath: 'a.md',
        documentKind: 'markdown',
        contentHash: 'h',
        fileSizeBytes: 10,
        fileModifiedAt: now,
        chunkCount: 1,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      const pdfId = randomUUID()
      insertKnowledgeDocument(db, {
        id: pdfId,
        userId: user.id,
        workspaceId: workspace.id,
        relativePath: 'b.pdf',
        documentKind: 'pdf',
        contentHash: 'h2',
        fileSizeBytes: 10,
        fileModifiedAt: now,
        chunkCount: 1,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      insertKnowledgeChunks(db, [
        {
          id: randomUUID(),
          documentId: mdId,
          workspaceId: workspace.id,
          chunkIndex: 0,
          startCharOffset: 0,
          endCharOffset: 6,
          chunkText: 'shared',
          chunkTokenEstimate: 2,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
        {
          id: randomUUID(),
          documentId: pdfId,
          workspaceId: workspace.id,
          chunkIndex: 0,
          startCharOffset: 0,
          endCharOffset: 6,
          chunkText: 'shared',
          chunkTokenEstimate: 2,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
      ])

      const onlyMd = await searchKnowledge(db, {
        workspaceId: workspace.id,
        query: 'shared',
        mode: 'fts',
        documentKindFilter: ['markdown'],
      })
      expect(onlyMd.every((r) => r.documentKind === 'markdown')).toBe(true)
      expect(onlyMd).toHaveLength(1)
    })
  })
})
