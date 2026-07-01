// Integration tests for hybrid memory search. Real SQLite + real
// FTS5 + real sqlite-vec extension load via `withTestDatabase`. No
// model in scope — embeddings are deterministic 384-float32 buffers
// constructed by hand. Spec: blueprint §4.3.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertEntry } from './memory-entries.js'
import { searchEntries, upsertVectorIndex, deleteVectorIndex } from './memory-search.js'

const EMBEDDING_DIM = 384

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

function makeEntry(
  userId: string,
  workspaceId: string,
  title: string,
  body: string,
  overrides: { isArchived?: boolean; deletedAt?: Date } = {},
) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'note' as const,
    title,
    body,
    category: 'memory' as const,
    section: 'Things to remember',
    sourceMessageId: null,
    createdSource: 'user-manual' as const,
    embedding: null,
    embeddingModelVersion: null,
    isArchived: overrides.isArchived ?? false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  }
}

// Build a 384-dim unit vector with a single non-zero component at `idx`.
// Lets a test create vectors that are far apart in L2 distance.
function unitVectorAt(idx: number): Buffer {
  const f = new Float32Array(EMBEDDING_DIM)
  f[idx] = 1
  return Buffer.from(f.buffer)
}

// Blend two unit vectors so the result is closer to A than to B in L2.
function blendedVector(idxA: number, idxB: number, weightA = 0.9): Buffer {
  const f = new Float32Array(EMBEDDING_DIM)
  f[idxA] = weightA
  f[idxB] = 1 - weightA
  return Buffer.from(f.buffer)
}

describe('memory-search repository', () => {
  describe('searchEntries mode=fts', () => {
    it('returns ranked FTS5 hits with <mark> snippets', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'Sarah at Acme', 'Head of partnerships at Acme.'),
        )
        insertEntry(
          db,
          makeEntry(
            user.id,
            workspace.id,
            'Tomato supplier',
            'Acme Produce sells tomatoes every Friday.',
          ),
        )
        insertEntry(
          db,
          makeEntry(
            user.id,
            workspace.id,
            'Quarterly review',
            'Discuss revenue with the finance team.',
          ),
        )

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          textQuery: 'tomato',
          mode: 'fts',
        })

        expect(results).toHaveLength(1)
        // FTS5 default tokenizer (unicode61) doesn't stem — "tomato" matches
        // only the title ("Tomato supplier"), not the body ("tomatoes ..."
        // is a different token). snippet() returns `<mark>` only on the
        // column that actually matched. Assert highlight on EITHER column.
        const r = results[0]!
        const hasMark = r.matchedTitle.includes('<mark>') || r.matchedBody.includes('<mark>')
        expect(hasMark).toBe(true)
        expect(typeof r.ftsScore).toBe('number')
        expect(typeof r.combinedScore).toBe('number')
        expect(r.semanticScore).toBeNull()
      })
    })

    it('filters out archived + soft-deleted entries', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, 'Visible', 'tomato salad'))
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'Archived', 'tomato sauce', { isArchived: true }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'Deleted', 'tomato soup', { deletedAt: new Date() }),
        )

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          textQuery: 'tomato',
          mode: 'fts',
        })

        expect(results).toHaveLength(1)
        expect(results[0]?.matchedTitle).toContain('Visible')
      })
    })

    it('returns empty when textQuery is missing', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const results = searchEntries(db, {
          workspaceId: workspace.id,
          mode: 'fts',
        })
        expect(results).toEqual([])
      })
    })
  })

  describe('searchEntries mode=semantic', () => {
    it('returns sqlite-vec KNN hits ordered by distance', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const e1 = insertEntry(db, makeEntry(user.id, workspace.id, 'Close', 'near the query'))
        const e2 = insertEntry(db, makeEntry(user.id, workspace.id, 'Far', 'orthogonal vector'))

        // e1's embedding is identical to the query; e2's is orthogonal.
        upsertVectorIndex(db, e1.id, workspace.id, unitVectorAt(0))
        upsertVectorIndex(db, e2.id, workspace.id, unitVectorAt(100))

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          embeddingQuery: unitVectorAt(0),
          mode: 'semantic',
          limit: 10,
        })

        expect(results).toHaveLength(2)
        expect(results[0]?.entryId).toBe(e1.id) // closer first
        expect(results[1]?.entryId).toBe(e2.id)
        expect(results[0]?.semanticScore).toBeGreaterThan(results[1]!.semanticScore!)
        // semanticScore mapped via 1/(1+d) — bounded (0,1].
        expect(results[0]?.semanticScore).toBeGreaterThan(0)
        expect(results[0]?.semanticScore).toBeLessThanOrEqual(1)
        expect(results[0]?.ftsScore).toBeNull()
      })
    })

    it('returns empty when embeddingQuery is missing', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const results = searchEntries(db, {
          workspaceId: workspace.id,
          mode: 'semantic',
        })
        expect(results).toEqual([])
      })
    })
  })

  describe('searchEntries mode=hybrid (RRF, k=60)', () => {
    it('combines FTS + semantic hits and sorts by combinedScore', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))

        // 3 entries with deliberate FTS vs semantic split:
        //   e1: FTS hit + close embedding  → BOTH sides; ranks top in hybrid
        //   e2: FTS hit + far embedding    → FTS only
        //   e3: no FTS hit + close embedding → semantic only
        const e1 = insertEntry(db, makeEntry(user.id, workspace.id, 'tomato red', 'tomato fresh'))
        const e2 = insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'tomato green', 'tomato unripe'),
        )
        const e3 = insertEntry(db, makeEntry(user.id, workspace.id, 'pepper sweet', 'pepper red'))
        upsertVectorIndex(db, e1.id, workspace.id, unitVectorAt(0))
        upsertVectorIndex(db, e2.id, workspace.id, unitVectorAt(100)) // orthogonal — won't rank near top
        upsertVectorIndex(db, e3.id, workspace.id, blendedVector(0, 50, 0.95)) // close to e1's vector

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          textQuery: 'tomato',
          embeddingQuery: unitVectorAt(0),
          mode: 'hybrid',
          limit: 10,
        })

        // e1 should rank first (on both sides → strongest combined RRF).
        expect(results[0]?.entryId).toBe(e1.id)
        // All three should appear somewhere in the result set.
        const ids = results.map((r) => r.entryId)
        expect(ids).toContain(e1.id)
        expect(ids).toContain(e2.id)
        expect(ids).toContain(e3.id)
        // combinedScore is the sum of 1/(60+rank) terms — strictly positive.
        for (const r of results) {
          expect(r.combinedScore).toBeGreaterThan(0)
        }
      })
    })

    it('handles fts-only hit, semantic-only hit, overlap independently', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        // ftsOnly: matches the text query but the embedding worker hasn't
        //   processed it yet — no row in memory_entries_vec.
        // semanticOnly: no text-query match; vec representation close to the query.
        // both: text-query match + close vec representation.
        const ftsOnly = insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'tomato keyword', 'tomato'),
        )
        const semanticOnly = insertEntry(
          db,
          makeEntry(user.id, workspace.id, 'red sphere', 'a round fruit'),
        )
        const both = insertEntry(db, makeEntry(user.id, workspace.id, 'tomato sauce', 'tomato'))
        // No upsertVectorIndex(ftsOnly) — pre-embedding state.
        upsertVectorIndex(db, semanticOnly.id, workspace.id, unitVectorAt(0))
        upsertVectorIndex(db, both.id, workspace.id, blendedVector(0, 10, 0.95))

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          textQuery: 'tomato',
          embeddingQuery: unitVectorAt(0),
          mode: 'hybrid',
          limit: 10,
        })

        const byEntry = new Map(results.map((r) => [r.entryId, r]))
        expect(byEntry.has(ftsOnly.id)).toBe(true)
        expect(byEntry.has(semanticOnly.id)).toBe(true)
        expect(byEntry.has(both.id)).toBe(true)

        // FTS-only: ftsScore present, semanticScore null.
        expect(byEntry.get(ftsOnly.id)?.ftsScore).not.toBeNull()
        expect(byEntry.get(ftsOnly.id)?.semanticScore).toBeNull()
        // Semantic-only: semanticScore present, ftsScore null.
        expect(byEntry.get(semanticOnly.id)?.semanticScore).not.toBeNull()
        expect(byEntry.get(semanticOnly.id)?.ftsScore).toBeNull()
        // Both: both populated.
        expect(byEntry.get(both.id)?.ftsScore).not.toBeNull()
        expect(byEntry.get(both.id)?.semanticScore).not.toBeNull()
      })
    })
  })

  describe('upsertVectorIndex', () => {
    it('inserts on first call, updates on conflict (idempotent)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const e1 = insertEntry(db, makeEntry(user.id, workspace.id, 't', 'b'))

        upsertVectorIndex(db, e1.id, workspace.id, unitVectorAt(0))
        upsertVectorIndex(db, e1.id, workspace.id, unitVectorAt(50)) // same entryId — overwrite

        const results = searchEntries(db, {
          workspaceId: workspace.id,
          embeddingQuery: unitVectorAt(50),
          mode: 'semantic',
        })
        // Single row in the vec table (overwrite, not duplicate); high score
        // (the upserted vector matches the query).
        expect(results).toHaveLength(1)
        expect(results[0]?.entryId).toBe(e1.id)
        expect(results[0]?.semanticScore).toBeGreaterThan(0.9)
      })
    })
  })

  describe('deleteVectorIndex', () => {
    it('removes the row by entryId (vec0 ignores SQL triggers — must call explicitly)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const e1 = insertEntry(db, makeEntry(user.id, workspace.id, 't', 'b'))
        upsertVectorIndex(db, e1.id, workspace.id, unitVectorAt(0))

        const before = searchEntries(db, {
          workspaceId: workspace.id,
          embeddingQuery: unitVectorAt(0),
          mode: 'semantic',
        })
        expect(before).toHaveLength(1)

        deleteVectorIndex(db, e1.id)

        const after = searchEntries(db, {
          workspaceId: workspace.id,
          embeddingQuery: unitVectorAt(0),
          mode: 'semantic',
        })
        expect(after).toHaveLength(0)
      })
    })
  })
})
