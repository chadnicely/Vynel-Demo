import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeSource,
  findKnowledgeDocumentByWorkspacePath,
  type KnowledgeSourceRow,
} from '../repositories/index.js'
import { FileWatcherService } from './file-watcher.js'

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

// chokidar's `awaitWriteFinish: { stabilityThreshold: 500 }` + our
// 300ms debounce means watch events take ~800ms to surface. Allow a
// generous timeout to remain stable on slower CI.
const WATCH_WAIT_MS = 2500

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-watcher-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function seedWorld(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspaceLocation: string,
) {
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
    path: workspaceLocation,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const source: KnowledgeSourceRow = {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    scope: 'workspace',
    sourceKind: 'directory',
    absolutePath: workspaceLocation,
    createdAt: now,
    updatedAt: now,
  }
  insertKnowledgeSource(db, source)
  return { user, workspace, source }
}

async function waitForDocument(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspaceId: string,
  relativePath: string,
  timeoutMs: number = WATCH_WAIT_MS,
): Promise<ReturnType<typeof findKnowledgeDocumentByWorkspacePath>> {
  // Wait for the row to reach a terminal state — the outbox event
  // co-commits with the `parsed` flip, so callers checking for the
  // event need to wait past `parsing` (the eager-claim status).
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const doc = findKnowledgeDocumentByWorkspacePath(db, workspaceId, relativePath)
    if (doc && doc.parseStatus !== 'parsing') return doc
    await sleep(100)
  }
  return null
}

describe('FileWatcherService', () => {
  it('indexes a file added after startWatching + records ActivityEvent', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedWorld(db, workspacePath)
      const service = new FileWatcherService(db, silentLogger)
      service.startWatchingSource(source)
      await sleep(200) // let chokidar's ready-event fire

      await writeFile(path.join(workspacePath, 'note.md'), '# hi', 'utf8')

      const doc = await waitForDocument(db, workspace.id, 'note.md')
      expect(doc).not.toBeNull()
      expect(doc!.parseStatus).toBe('parsed')

      const activity = service.getActivityForSource(source.id)
      expect(activity.some((e) => e.relativePath === 'note.md' && e.eventKind === 'added')).toBe(
        true,
      )

      await service.stopWatchingSource(source.id)
    })
  }, 10000)

  it('removes from index when a watched file is deleted', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedWorld(db, workspacePath)
      const filePath = path.join(workspacePath, 'gone.md')
      await writeFile(filePath, 'will be deleted', 'utf8')

      const service = new FileWatcherService(db, silentLogger)
      service.startWatchingSource(source)
      await sleep(200)

      // First, add — chokidar with ignoreInitial:true won't see the
      // existing file; we explicitly write a new path then delete it.
      await writeFile(path.join(workspacePath, 'tracker.md'), 'tracker', 'utf8')
      await waitForDocument(db, workspace.id, 'tracker.md')

      // Now delete the pre-existing file's PATH — chokidar's `add` for
      // a deleted-then-deleted absent file: simpler test is to delete
      // the tracker.md we just indexed and verify the row goes away.
      await unlink(path.join(workspacePath, 'tracker.md'))

      const deadline = Date.now() + WATCH_WAIT_MS
      while (Date.now() < deadline) {
        const row = findKnowledgeDocumentByWorkspacePath(db, workspace.id, 'tracker.md')
        if (!row) break
        await sleep(100)
      }
      expect(findKnowledgeDocumentByWorkspacePath(db, workspace.id, 'tracker.md')).toBeNull()

      const activity = service.getActivityForSource(source.id)
      expect(
        activity.some((e) => e.relativePath === 'tracker.md' && e.eventKind === 'removed'),
      ).toBe(true)

      // Cleanup the never-removed gone.md
      try {
        await unlink(filePath)
      } catch {
        /* may already be cleaned up */
      }
      await service.stopWatchingSource(source.id)
    })
  }, 15000)

  it('startWatching is idempotent — second call for same workspace is a no-op', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedWorld(db, workspacePath)
      const service = new FileWatcherService(db, silentLogger)
      service.startWatchingSource(source)
      service.startWatchingSource(source)
      // No throw + a single watcher under the hood (only one closes cleanly)
      await service.stopWatchingSource(source.id)
    })
  })

  it('stopWatching is a no-op for an unknown workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const service = new FileWatcherService(db, silentLogger)
      await expect(service.stopWatchingWorkspace('unknown-id')).resolves.toBeUndefined()
    })
  })

  it('activity ring buffer caps at 100 events per workspace', async () => {
    await withTestDatabase((db) => {
      const { source } = seedWorld(db, workspacePath)
      const service = new FileWatcherService(db, silentLogger)
      // Use private hook for the ring buffer test (mirrors memory-style
      // bounded tests for in-memory state).
      const recordActivity = (
        service as unknown as { recordActivity(id: string, e: unknown): void }
      ).recordActivity.bind(service)

      for (let i = 0; i < 150; i++) {
        recordActivity(source.id, {
          at: new Date(),
          sourceId: source.id,
          eventKind: 'added',
          relativePath: `f-${i}.md`,
        })
      }
      const ring = service.getActivityForSource(source.id)
      expect(ring).toHaveLength(100)
      expect(ring[0]!.relativePath).toBe('f-50.md') // first 50 evicted
      expect(ring[99]!.relativePath).toBe('f-149.md')
    })
  })
})
