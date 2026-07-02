// Tests for the three activity ops (listRecentActivity, listFileHistory,
// purgeOldFileActivities). Pure DB orchestration over the repo —
// real SQLite via @vynel/testing.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import {
  insertFileActivity,
  listFileActivitiesForWorkspace,
  type NewFileActivity,
} from '@vynel/db/repositories/files'
import { listRecentActivity } from './list-recent-activity.js'
import { listFileHistory } from './list-file-history.js'
import { purgeOldFileActivities } from './purge-old-file-activities.js'
import { seedUserAndWorkspace } from './_test-helpers.js'

function makeRow(
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
    fileSizeBytes: 10,
    occurredAt: new Date(),
    ...overrides,
  }
}

describe('listRecentActivity', () => {
  it('paginates via the (occurredAt, id) cursor', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = await seedUserAndWorkspace(db)
      const base = new Date(2026, 4, 1).getTime()
      for (let i = 0; i < 5; i++) {
        insertFileActivity(
          db,
          makeRow(userId, workspaceId, {
            relativePath: `f-${i}.md`,
            occurredAt: new Date(base + i * 1000),
          }),
        )
      }
      const page1 = listRecentActivity(db, { workspaceId, limit: 2 })
      expect(page1.activities.map((a) => a.relativePath)).toEqual(['f-4.md', 'f-3.md'])
      expect(page1.nextCursor).not.toBeNull()

      const page2 = listRecentActivity(db, {
        workspaceId,
        limit: 2,
        cursor: page1.nextCursor!,
      })
      expect(page2.activities.map((a) => a.relativePath)).toEqual(['f-2.md', 'f-1.md'])

      const page3 = listRecentActivity(db, {
        workspaceId,
        limit: 2,
        cursor: page2.nextCursor!,
      })
      expect(page3.activities.map((a) => a.relativePath)).toEqual(['f-0.md'])
      expect(page3.nextCursor).toBeNull()
    })
  })

  it('returns empty + nextCursor:null for an empty workspace', async () => {
    await withTestDatabase(async (db) => {
      const { workspaceId } = await seedUserAndWorkspace(db)
      const result = listRecentActivity(db, { workspaceId })
      expect(result.activities).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })
})

describe('listFileHistory', () => {
  it("filters to one relativePath only", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = await seedUserAndWorkspace(db)
      insertFileActivity(db, makeRow(userId, workspaceId, { relativePath: 'a.md' }))
      insertFileActivity(db, makeRow(userId, workspaceId, { relativePath: 'b.md' }))
      insertFileActivity(db, makeRow(userId, workspaceId, { relativePath: 'a.md' }))

      const result = listFileHistory(db, { workspaceId, relativePath: 'a.md' })
      expect(result.activities).toHaveLength(2)
      expect(result.activities.every((a) => a.relativePath === 'a.md')).toBe(true)
    })
  })
})

describe('purgeOldFileActivities', () => {
  it('deletes rows older than 90 days from `now`', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = await seedUserAndWorkspace(db)
      const now = new Date('2026-05-29T00:00:00Z')
      // 100 days old — should be purged
      insertFileActivity(
        db,
        makeRow(userId, workspaceId, {
          relativePath: 'old.md',
          occurredAt: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000),
        }),
      )
      // 80 days old — should survive
      insertFileActivity(
        db,
        makeRow(userId, workspaceId, {
          relativePath: 'fresh.md',
          occurredAt: new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000),
        }),
      )

      const result = purgeOldFileActivities(db, { now })
      expect(result.deletedCount).toBe(1)
      const remaining = listFileActivitiesForWorkspace(db, workspaceId)
      expect(remaining.map((r) => r.relativePath)).toEqual(['fresh.md'])
    })
  })

  it('returns 0 when nothing matches the cutoff', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = await seedUserAndWorkspace(db)
      insertFileActivity(db, makeRow(userId, workspaceId))
      const result = purgeOldFileActivities(db, { now: new Date('2026-05-29T00:00:00Z') })
      expect(result.deletedCount).toBe(0)
    })
  })
})
