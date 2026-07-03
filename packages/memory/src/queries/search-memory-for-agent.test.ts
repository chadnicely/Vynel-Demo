import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertEntry, upsertVectorIndex } from '../repositories/index.js'
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
  generateEmbedding: inlineFakeEmbedding,
}))

const fakeGenerateEmbedding = inlineFakeEmbedding

import { searchMemoryForAgent } from './search-memory-for-agent.js'

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

describe('searchMemoryForAgent', () => {
  it('runs FTS-only with no embedding model call (textQuery only)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedEntry(db, user.id, workspace.id, 'Tomato supplier', 'Acme sells tomato every Friday.')
      seedEntry(db, user.id, workspace.id, 'Pepper supplier', 'Beta sells pepper.')

      const results = await searchMemoryForAgent(db, {
        workspaceId: workspace.id,
        query: 'tomato',
        mode: 'fts',
      })
      expect(results).toHaveLength(1)
      const r = results[0]!
      expect(r.matchedTitle + r.matchedBody).toContain('<mark>')
      expect(r.semanticScore).toBeNull()
    })
  })

  it('runs hybrid (default) — embedding + FTS, fused via RRF', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const e1 = seedEntry(db, user.id, workspace.id, 'tomato red', 'tomato fresh')
      const e2 = seedEntry(db, user.id, workspace.id, 'pepper green', 'pepper unripe')
      // Seed vec entries deterministically via the fake.
      upsertVectorIndex(db, e1.id, workspace.id, await fakeGenerateEmbedding('tomato'))
      upsertVectorIndex(db, e2.id, workspace.id, await fakeGenerateEmbedding('pepper'))

      const results = await searchMemoryForAgent(db, {
        workspaceId: workspace.id,
        query: 'tomato',
        // mode omitted → defaults to hybrid
      })
      expect(results.length).toBeGreaterThanOrEqual(1)
      // e1 should rank first (matches both fts AND semantic).
      expect(results[0]?.entryId).toBe(e1.id)
    })
  })

  it('runs semantic-only (no textQuery in the SQL)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const e1 = seedEntry(db, user.id, workspace.id, 'unrelated title', 'unrelated body')
      upsertVectorIndex(db, e1.id, workspace.id, await fakeGenerateEmbedding('xyz query'))

      const results = await searchMemoryForAgent(db, {
        workspaceId: workspace.id,
        query: 'xyz query',
        mode: 'semantic',
      })
      expect(results).toHaveLength(1)
      expect(results[0]?.entryId).toBe(e1.id)
      expect(results[0]?.ftsScore).toBeNull()
    })
  })
})
