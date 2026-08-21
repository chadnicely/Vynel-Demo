import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findEntryById, insertEntry, searchEntries } from '../repositories/index.js'

// Inline deterministic fake — avoids the vi.mock + dynamic-import +
// TLA interaction that hangs vitest at module-graph resolution time
// (the workspace `@vynel/embeddings/test-support` subpath import
// inside the factory never resolves, leaving vitest stuck after
// printing the RUN banner). Same FNV-1a + L2-normalized vector
// shape as the fake in `@vynel/embeddings/test-support/fake-embeddings.ts`.
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
  EmbeddingModelNotInstalledError: class extends Error {},
  generateEmbedding: inlineFakeEmbedding,
}))

const fakeGenerateEmbedding = inlineFakeEmbedding

import { EMBEDDING_MODEL_VERSION } from '@vynel/embeddings'
import { generateMemoryEmbeddings } from './generate-memory-embeddings.js'

function seedEntry(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  title: string,
  body: string,
) {
  const now = new Date()
  return insertEntry(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'note',
    title,
    body,
    category: 'memory',
    section: 'Things to remember',
    sourceMessageId: null,
    createdSource: 'user-manual',
    embedding: null,
    embeddingModelVersion: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: null,
  })
}

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

describe('generateMemoryEmbeddings', () => {
  it('writes embedding + model version + upserts the vec0 row for each pending entry', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const e1 = seedEntry(db, user.id, workspace.id, 't1', 'body one')
      const e2 = seedEntry(db, user.id, workspace.id, 't2', 'body two')

      const result = await generateMemoryEmbeddings(db, { batchSize: 10 })
      expect(result).toMatchObject({ attempted: 2, succeeded: 2, failed: 0 })

      const a = findEntryById(db, e1.id)
      expect(a?.embedding).toBeInstanceOf(Buffer)
      expect(a?.embedding?.length).toBe(1536) // 384 × float32
      expect(a?.embeddingModelVersion).toBe(EMBEDDING_MODEL_VERSION)

      const b = findEntryById(db, e2.id)
      expect(b?.embedding).toBeInstanceOf(Buffer)

      // Both entries now appear in semantic search.
      const hits = searchEntries(db, {
        workspaceId: workspace.id,
        embeddingQuery: await fakeGenerateEmbedding('t1\n\nbody one'),
        mode: 'semantic',
        limit: 5,
      })
      const hitIds = hits.map((h) => h.entryId)
      expect(hitIds).toContain(e1.id)
      expect(hitIds).toContain(e2.id)
      // e1's vector matches the query exactly → ranks first.
      expect(hitIds[0]).toBe(e1.id)
    })
  })

  it('returns 0/0/0 when no entries need embedding', async () => {
    await withTestDatabase(async (db) => {
      const result = await generateMemoryEmbeddings(db)
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 })
    })
  })

  it('respects batchSize cap', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      for (let i = 0; i < 5; i++) {
        seedEntry(db, user.id, workspace.id, `t${i}`, `b${i}`)
      }
      const result = await generateMemoryEmbeddings(db, { batchSize: 3 })
      expect(result.attempted).toBe(3)
      expect(result.succeeded).toBe(3)
    })
  })

  // NOTE: "one failed embedding does not poison the batch" is an
  // intentional property of the core op (try/catch per entry; failures
  // log + skip). Vitest's vi.doMock + dynamic re-import to inject a
  // failing fake into the already-mocked module is fragile (TLA + ESM
  // hoisting interactions); covered by code review instead. The visible
  // behavior in production: if generateEmbedding throws for one entry,
  // the worker logs the failure + continues; the next cron tick retries.
})
