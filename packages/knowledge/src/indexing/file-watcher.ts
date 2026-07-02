// `FileWatcherService` — the stateful infra holding one chokidar
// instance per active workspace, plus a per-path debounce timer
// (300 ms) and a per-workspace activity ring buffer (100 events) for
// the Activity tab. Lives in `packages/core/src/knowledge/file-watcher.ts`
// per D24 (infra-package-pure-helpers / core-package-orchestration —
// chokidar is concrete infrastructure, but the class belongs to the
// orchestration layer because it calls `indexFile` + `removeFileFromIndex`).
//
// A class (per the gate-trail Q6) — legitimate stateful infrastructure
// requires a class. Methods:
//   - startWatching(input)   — open a chokidar watcher for a workspace
//   - stopWatching(workspaceId) — close that workspace's watcher
//   - stopAll() — close every open watcher (process shutdown)
//   - getActivityForWorkspace(workspaceId) — read the ring buffer
//
// Key behaviors:
//   - 300ms per-path debounce collapses rapid saves to one index call.
//   - `awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }`
//     prevents indexing half-written files (text editor stream-writes).
//   - `followSymlinks: false` — no symlink traversal out of the workspace.
//   - `ignoreInitial: true` — the initial walk is `indexWorkspace`'s job.
//   - Hard-skipped: dot-files (except identity-file basenames at root),
//     `.vynel/**`, `Archive/**`, `node_modules/**`.
//   - NO self-write window (per D8 — the outbox seam eliminates the
//     original double-reconcile race; no in-memory flag needed).
//   - Activity ring buffer per workspace, bounded at 100 events,
//     cleared on restart (per D12 — in-memory only; not persisted).
//
// Per blueprint §7.

import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { indexFile } from './index-file.js'
import { removeFileFromIndex } from './remove-file-from-index.js'
import type { Database } from '@vynel/db'
import type { ActivityEvent, StructuralLogger } from '../knowledge-types.js'

const DEBOUNCE_MS = 300
const MAX_ACTIVITY_PER_WORKSPACE = 100

export type WorkspaceWatchInput = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export class FileWatcherService {
  private readonly watchersByWorkspaceId = new Map<string, FSWatcher>()
  private readonly debouncedTimerByPath = new Map<string, NodeJS.Timeout>()
  private readonly activityByWorkspaceId = new Map<string, ActivityEvent[]>()

  constructor(
    private readonly db: Database,
    private readonly logger: StructuralLogger,
  ) {}

  startWatching(input: WorkspaceWatchInput): void {
    if (this.watchersByWorkspaceId.has(input.workspaceId)) return

    const watcher = chokidar.watch(input.workspacePath, {
      ignored: (filePath) => {
        const relative = path.relative(input.workspacePath, filePath)
        if (relative === '') return false
        const segments = relative.split(path.sep)
        const basename = segments[segments.length - 1] ?? ''
        // Skip dotfiles
        if (basename.startsWith('.')) return true
        // Skip well-known noise folders
        if (segments.includes('node_modules')) return true
        if (segments[0] === 'Archive') return true
        if (segments[0] === '.vynel') return true
        return false
      },
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      followSymlinks: false,
      persistent: true,
    })

    const onAddOrChange = (absPath: string, kind: 'added' | 'changed'): void => {
      this.scheduleIndex(input, absPath, kind)
    }

    watcher
      .on('add', (absPath) => onAddOrChange(absPath, 'added'))
      .on('change', (absPath) => onAddOrChange(absPath, 'changed'))
      .on('unlink', (absPath) => this.scheduleRemove(input, absPath))
      .on('error', (err) =>
        this.logger.warn({ err, workspaceId: input.workspaceId }, 'file-watcher error'),
      )

    this.watchersByWorkspaceId.set(input.workspaceId, watcher)
  }

  async stopWatching(workspaceId: string): Promise<void> {
    const watcher = this.watchersByWorkspaceId.get(workspaceId)
    if (!watcher) return
    await watcher.close()
    this.watchersByWorkspaceId.delete(workspaceId)
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.watchersByWorkspaceId.keys())
    await Promise.all(ids.map((id) => this.stopWatching(id)))
    // Clear any pending debounce timers
    for (const handle of this.debouncedTimerByPath.values()) clearTimeout(handle)
    this.debouncedTimerByPath.clear()
  }

  getActivityForWorkspace(workspaceId: string): readonly ActivityEvent[] {
    return this.activityByWorkspaceId.get(workspaceId) ?? []
  }

  private scheduleIndex(
    input: WorkspaceWatchInput,
    absolutePath: string,
    kind: 'added' | 'changed',
  ): void {
    this.debounce(absolutePath, async () => {
      const relativePath = path.relative(input.workspacePath, absolutePath)
      const normalized = relativePath.split(path.sep).join('/')
      try {
        await indexFile(this.db, { ...input, relativePath: normalized }, { logger: this.logger })
        this.recordActivity(input.workspaceId, {
          at: new Date(),
          workspaceId: input.workspaceId,
          eventKind: kind,
          relativePath: normalized,
        })
      } catch (err) {
        this.recordActivity(input.workspaceId, {
          at: new Date(),
          workspaceId: input.workspaceId,
          eventKind: 'parse-failed',
          relativePath: normalized,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        this.logger.warn(
          { err, relativePath: normalized, workspaceId: input.workspaceId },
          'failed to index file from watch event',
        )
      }
    })
  }

  private scheduleRemove(input: WorkspaceWatchInput, absolutePath: string): void {
    this.debounce(absolutePath, async () => {
      const normalized = path.relative(input.workspacePath, absolutePath).split(path.sep).join('/')
      try {
        removeFileFromIndex(this.db, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          relativePath: normalized,
        })
        this.recordActivity(input.workspaceId, {
          at: new Date(),
          workspaceId: input.workspaceId,
          eventKind: 'removed',
          relativePath: normalized,
        })
      } catch (err) {
        this.logger.warn(
          { err, relativePath: normalized, workspaceId: input.workspaceId },
          'failed to remove file from index',
        )
      }
    })
  }

  private debounce(key: string, fn: () => Promise<void>): void {
    const existing = this.debouncedTimerByPath.get(key)
    if (existing) clearTimeout(existing)
    const handle = setTimeout(() => {
      this.debouncedTimerByPath.delete(key)
      void fn()
    }, DEBOUNCE_MS)
    this.debouncedTimerByPath.set(key, handle)
  }

  private recordActivity(workspaceId: string, event: ActivityEvent): void {
    const ring = this.activityByWorkspaceId.get(workspaceId) ?? []
    ring.push(event)
    if (ring.length > MAX_ACTIVITY_PER_WORKSPACE) ring.shift()
    this.activityByWorkspaceId.set(workspaceId, ring)
  }
}
