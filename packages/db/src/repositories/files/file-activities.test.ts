// Repository tests for `file_activities`. Real SQLite via the local
// withTestDatabase helper (`.claude/memory/decisions/phase-1-sync-
// transactions.md` + `docs/foundation.md §2 row 12` — no DB mocking).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  insertFileActivity,
  listFileActivitiesForWorkspace,
  listFileActivitiesForPath,
  findRecentSelfActivityForPath,
  hardDeleteFileActivitiesOccurredBefore,
  type NewFileActivity,
} from './file-activities.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
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

function makeFileActivity(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewFileActivity> = {},
): NewFileActivity {
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    activityKind: 'file-edited',
    editor: 'self',
    relativePath: 'notes/todo.md',
    fromPath: null,
    fileSizeBytes: 42,
    occurredAt: new Date(),
    ...overrides,
  }
}

describe('file-activities repository', () => {
  describe('insertFileActivity', () => {
    it('inserts a row and returns it (id supplied by caller)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const row = makeFileActivity(user.id, workspace.id)
        const inserted = insertFileActivity(db, row)
        expect(inserted.id).toBe(row.id)
        expect(inserted.activityKind).toBe('file-edited')
        expect(inserted.editor).toBe('self')
        expect(inserted.relativePath).toBe('notes/todo.md')
        expect(inserted.fileSizeBytes).toBe(42)
      })
    })

    it('persists the editor discriminator (self vs external)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const selfRow = insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, { editor: 'self' }),
        )
        const externalRow = insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, { editor: 'external' }),
        )
        expect(selfRow.editor).toBe('self')
        expect(externalRow.editor).toBe('external')
      })
    })
  })

  describe('listFileActivitiesForWorkspace', () => {
    it('returns empty when no rows exist', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(listFileActivitiesForWorkspace(db, workspace.id)).toEqual([])
      })
    })

    it('orders by (occurredAt DESC, id DESC) and respects the limit', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const base = new Date(2026, 4, 1).getTime()
        for (let i = 0; i < 5; i++) {
          insertFileActivity(
            db,
            makeFileActivity(user.id, workspace.id, {
              relativePath: `f-${i}.md`,
              occurredAt: new Date(base + i * 1000),
            }),
          )
        }
        const rows = listFileActivitiesForWorkspace(db, workspace.id, { limit: 3 })
        expect(rows).toHaveLength(3)
        // Newest first
        expect(rows[0]?.relativePath).toBe('f-4.md')
        expect(rows[1]?.relativePath).toBe('f-3.md')
        expect(rows[2]?.relativePath).toBe('f-2.md')
      })
    })

    it('paginates via the (occurredAt, id) cursor', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const base = new Date(2026, 4, 1).getTime()
        for (let i = 0; i < 6; i++) {
          insertFileActivity(
            db,
            makeFileActivity(user.id, workspace.id, {
              relativePath: `f-${i}.md`,
              occurredAt: new Date(base + i * 1000),
            }),
          )
        }
        const firstPage = listFileActivitiesForWorkspace(db, workspace.id, { limit: 3 })
        expect(firstPage.map((r) => r.relativePath)).toEqual(['f-5.md', 'f-4.md', 'f-3.md'])
        const lastOfFirst = firstPage[firstPage.length - 1]!
        const secondPage = listFileActivitiesForWorkspace(db, workspace.id, {
          limit: 3,
          cursor: { occurredAt: lastOfFirst.occurredAt, id: lastOfFirst.id },
        })
        expect(secondPage.map((r) => r.relativePath)).toEqual(['f-2.md', 'f-1.md', 'f-0.md'])
      })
    })

    it('scopes to the supplied workspaceId (tenant isolation)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const wsA = insertWorkspace(db, makeWorkspace(user.id))
        const wsB = insertWorkspace(db, makeWorkspace(user.id))
        insertFileActivity(db, makeFileActivity(user.id, wsA.id, { relativePath: 'a.md' }))
        insertFileActivity(db, makeFileActivity(user.id, wsB.id, { relativePath: 'b.md' }))
        expect(listFileActivitiesForWorkspace(db, wsA.id).map((r) => r.relativePath)).toEqual([
          'a.md',
        ])
        expect(listFileActivitiesForWorkspace(db, wsB.id).map((r) => r.relativePath)).toEqual([
          'b.md',
        ])
      })
    })
  })

  describe('listFileActivitiesForPath', () => {
    it('filters by exact relativePath + paginates the same way', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const base = new Date(2026, 4, 1).getTime()
        for (let i = 0; i < 4; i++) {
          insertFileActivity(
            db,
            makeFileActivity(user.id, workspace.id, {
              relativePath: 'notes/todo.md',
              occurredAt: new Date(base + i * 1000),
            }),
          )
        }
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, {
            relativePath: 'other.md',
            occurredAt: new Date(base + 999_999),
          }),
        )
        const rows = listFileActivitiesForPath(db, workspace.id, 'notes/todo.md')
        expect(rows).toHaveLength(4)
        expect(rows.every((r) => r.relativePath === 'notes/todo.md')).toBe(true)
      })
    })
  })

  describe('findRecentSelfActivityForPath', () => {
    it('returns null when no matching self row exists', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(
          findRecentSelfActivityForPath(db, workspace.id, 'x.md', {
            now: new Date(),
            sinceMs: 5_000,
          }),
        ).toBeNull()
      })
    })

    it('returns the latest self row within sinceMs', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const now = new Date()
        // 2s ago — within the 5s window
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, {
            relativePath: 'x.md',
            editor: 'self',
            occurredAt: new Date(now.getTime() - 2_000),
          }),
        )
        const found = findRecentSelfActivityForPath(db, workspace.id, 'x.md', {
          now,
          sinceMs: 5_000,
        })
        expect(found?.editor).toBe('self')
        expect(found?.relativePath).toBe('x.md')
      })
    })

    it('skips rows outside the sinceMs window', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const now = new Date()
        // 10s ago — outside the 5s window
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, {
            relativePath: 'x.md',
            editor: 'self',
            occurredAt: new Date(now.getTime() - 10_000),
          }),
        )
        expect(
          findRecentSelfActivityForPath(db, workspace.id, 'x.md', { now, sinceMs: 5_000 }),
        ).toBeNull()
      })
    })

    it("ignores editor='external' rows (the dedup is one-directional)", async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const now = new Date()
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, {
            relativePath: 'x.md',
            editor: 'external',
            occurredAt: new Date(now.getTime() - 1_000),
          }),
        )
        expect(
          findRecentSelfActivityForPath(db, workspace.id, 'x.md', { now, sinceMs: 5_000 }),
        ).toBeNull()
      })
    })
  })

  describe('hardDeleteFileActivitiesOccurredBefore', () => {
    it('returns 0 when no rows match the cutoff', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertFileActivity(db, makeFileActivity(user.id, workspace.id))
        const cutoff = new Date(2020, 0, 1)
        expect(hardDeleteFileActivitiesOccurredBefore(db, cutoff)).toBe(0)
      })
    })

    it('deletes rows older than the cutoff and returns the count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const old = new Date(2020, 0, 1)
        const fresh = new Date()
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, { occurredAt: old, relativePath: 'old-1.md' }),
        )
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, { occurredAt: old, relativePath: 'old-2.md' }),
        )
        insertFileActivity(
          db,
          makeFileActivity(user.id, workspace.id, { occurredAt: fresh, relativePath: 'new.md' }),
        )
        const cutoff = new Date(2021, 0, 1)
        expect(hardDeleteFileActivitiesOccurredBefore(db, cutoff)).toBe(2)
        const remaining = listFileActivitiesForWorkspace(db, workspace.id)
        expect(remaining.map((r) => r.relativePath)).toEqual(['new.md'])
      })
    })
  })
})
