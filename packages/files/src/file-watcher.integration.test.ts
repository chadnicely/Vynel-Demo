// Integration test for FilesFileWatcherService. Real chokidar + real
// SQLite + real temp workspace. Short awaitWriteFinish thresholds for
// test speed.

import { mkdir, rm, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import {
  insertFileActivity,
  listFileActivitiesForWorkspace,
  type FileActivity,
} from '@vynel/db/repositories/files'
import { randomUUID } from 'node:crypto'
import { FilesFileWatcherService } from './file-watcher.js'
import { seedUserAndWorkspace } from './_test-helpers.js'

const TEST_OPTIONS = {
  stabilityThresholdMs: 30,
  pollIntervalMs: 10,
  debounceMs: 50,
}

const QUIET_LOGGER = { info: vi.fn(), warn: vi.fn() }

function waitFor(predicate: () => boolean, timeoutMs = 5_000, intervalMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitFor: timed out after ${timeoutMs}ms`))
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

describe('FilesFileWatcherService', () => {
  let service: FilesFileWatcherService | null = null

  beforeEach(() => {
    QUIET_LOGGER.info.mockReset()
    QUIET_LOGGER.warn.mockReset()
  })

  afterEach(async () => {
    if (service) {
      await service.stopAll()
      service = null
    }
  })

  it("records editor:'external' rows for outside writes", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      service = new FilesFileWatcherService(db, QUIET_LOGGER, TEST_OPTIONS)
      service.startWatching({ userId, workspaceId, workspacePath })

      // chokidar may take ~20-50ms to be "ready" after startWatching;
      // give it room before the fs write.
      await new Promise((r) => setTimeout(r, 100))

      await writeFile(path.join(workspacePath, 'outside.md'), 'hello', 'utf8')

      await waitFor(() => {
        const rows = listFileActivitiesForWorkspace(db, workspaceId)
        return rows.length > 0
      })

      const rows = listFileActivitiesForWorkspace(db, workspaceId)
      const externalRow = rows.find((r) => r.relativePath === 'outside.md')
      expect(externalRow).toBeDefined()
      expect(externalRow?.editor).toBe('external')
      expect(externalRow?.activityKind).toBe('file-created')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("dedups against a recent editor:'self' row for the same path", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      service = new FilesFileWatcherService(db, QUIET_LOGGER, TEST_OPTIONS)
      service.startWatching({ userId, workspaceId, workspacePath })
      await new Promise((r) => setTimeout(r, 100))

      // Simulate a user-manager save: write the file AND insert the
      // editor:'self' row synchronously (the way writeFileContent does).
      // The watcher then fires; the dedup query should see the recent
      // 'self' row and skip the 'external' insert.
      const now = new Date()
      const selfRow: FileActivity = {
        id: randomUUID(),
        userId,
        workspaceId,
        activityKind: 'file-created',
        editor: 'self',
        relativePath: 'saved.md',
        fromPath: null,
        fileSizeBytes: 5,
        occurredAt: now,
      }
      insertFileActivity(db, selfRow)
      await writeFile(path.join(workspacePath, 'saved.md'), 'hello', 'utf8')

      // Give chokidar time to fire + the debounce window to elapse.
      await new Promise((r) => setTimeout(r, 400))

      const rows = listFileActivitiesForWorkspace(db, workspaceId)
      const forSaved = rows.filter((r) => r.relativePath === 'saved.md')
      // ONLY the 'self' row exists — the watcher's 'external' insert
      // was deduped because the dedup window saw the recent 'self' row.
      expect(forSaved).toHaveLength(1)
      expect(forSaved[0]?.editor).toBe('self')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("records folder-created + folder-deleted on directory ops", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      service = new FilesFileWatcherService(db, QUIET_LOGGER, TEST_OPTIONS)
      service.startWatching({ userId, workspaceId, workspacePath })
      await new Promise((r) => setTimeout(r, 100))

      const subdir = path.join(workspacePath, 'newsub')
      await mkdir(subdir)
      await waitFor(() => {
        const rows = listFileActivitiesForWorkspace(db, workspaceId)
        return rows.some((r) => r.activityKind === 'folder-created' && r.relativePath === 'newsub')
      })

      await rm(subdir, { recursive: true })
      await waitFor(() => {
        const rows = listFileActivitiesForWorkspace(db, workspaceId)
        return rows.some((r) => r.activityKind === 'folder-deleted' && r.relativePath === 'newsub')
      })

      const rows = listFileActivitiesForWorkspace(db, workspaceId)
      const kinds = rows
        .filter((r) => r.relativePath === 'newsub')
        .map((r) => r.activityKind)
        .sort()
      expect(kinds).toEqual(['folder-created', 'folder-deleted'])

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("records file-deleted on unlink", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'doomed.md'), 'x', 'utf8')

      service = new FilesFileWatcherService(db, QUIET_LOGGER, TEST_OPTIONS)
      service.startWatching({ userId, workspaceId, workspacePath })
      await new Promise((r) => setTimeout(r, 100))

      await unlink(path.join(workspacePath, 'doomed.md'))

      await waitFor(() => {
        const rows = listFileActivitiesForWorkspace(db, workspaceId)
        return rows.some((r) => r.activityKind === 'file-deleted' && r.relativePath === 'doomed.md')
      })

      const row = listFileActivitiesForWorkspace(db, workspaceId).find(
        (r) => r.activityKind === 'file-deleted',
      )
      expect(row?.editor).toBe('external')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("ignores .vynel/ + node_modules/ + dotfiles", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      // Create the ignored dirs BEFORE starting the watcher.
      await mkdir(path.join(workspacePath, '.vynel'))
      await mkdir(path.join(workspacePath, 'node_modules'))

      service = new FilesFileWatcherService(db, QUIET_LOGGER, TEST_OPTIONS)
      service.startWatching({ userId, workspaceId, workspacePath })
      await new Promise((r) => setTimeout(r, 100))

      await writeFile(path.join(workspacePath, '.vynel', 'state.json'), '{}', 'utf8')
      await writeFile(
        path.join(workspacePath, 'node_modules', 'fake', 'index.js'),
        'x',
        'utf8',
      ).catch(async () => {
        // node_modules/fake/ doesn't exist; mkdir + write.
        await mkdir(path.join(workspacePath, 'node_modules', 'fake'))
        await writeFile(path.join(workspacePath, 'node_modules', 'fake', 'index.js'), 'x', 'utf8')
      })
      await writeFile(path.join(workspacePath, '.DS_Store'), 'macnoise', 'utf8')
      // Also write a visible file so we can verify the watcher IS active.
      await writeFile(path.join(workspacePath, 'visible.md'), 'hi', 'utf8')

      await waitFor(() => {
        const rows = listFileActivitiesForWorkspace(db, workspaceId)
        return rows.some((r) => r.relativePath === 'visible.md')
      })

      const allPaths = listFileActivitiesForWorkspace(db, workspaceId).map((r) => r.relativePath)
      expect(allPaths).toContain('visible.md')
      expect(allPaths.some((p) => p.startsWith('.vynel'))).toBe(false)
      expect(allPaths.some((p) => p.startsWith('node_modules'))).toBe(false)
      expect(allPaths.some((p) => p === '.DS_Store')).toBe(false)

      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})
