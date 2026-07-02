// `FilesFileWatcherService` — owns one chokidar instance per active
// workspace. Detects every fs event (add / change / unlink + addDir
// / unlinkDir) and inserts `editor: 'external'` activity rows, with
// a 5-second dedup query against findRecentSelfActivityForPath to
// suppress duplicates of user-manager actions.
//
// The decision to run a SEPARATE watcher from knowledge (rather than
// subscribe to its events) is locked at D17 — different responsibilities
// (knowledge indexes content; files audits all fs activity, including
// folder ops + unsupported-extension files that knowledge skips).
//
// Safety posture mirrors knowledge's FileWatcherService:
//   followSymlinks: false, awaitWriteFinish, ignored set, 300ms debounce.

import chokidar, { type FSWatcher } from 'chokidar'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { withTransaction, type Database } from '@vynel/db'
import {
  findRecentSelfActivityForPath,
  insertFileActivity,
  type FileActivityKind,
} from '@vynel/db/repositories/files'
import type { StructuralLogger } from './files-types.js'

const DEBOUNCE_MS = 300

// 5-second dedup window —
// the watcher suppresses its `external` activity row for Vynel's own writes
// recorded within this window (via findRecentSelfActivityForPath). Sole
// consumer, so it lives here rather than on the domain's public surface.
const ACTIVITY_DEDUP_WINDOW_MS = 5_000

export type WorkspaceWatchInput = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export type FilesFileWatcherOptions = {
  // Chokidar's awaitWriteFinish lag is what the dedup window protects
  // against. Tests can override to a much smaller value for speed.
  stabilityThresholdMs?: number
  pollIntervalMs?: number
  debounceMs?: number
}

export class FilesFileWatcherService {
  private readonly watchersByWorkspaceId = new Map<string, FSWatcher>()
  private readonly debouncedTimerByPath = new Map<string, NodeJS.Timeout>()
  private readonly options: Required<FilesFileWatcherOptions>

  constructor(
    private readonly db: Database,
    private readonly logger: StructuralLogger,
    options: FilesFileWatcherOptions = {},
  ) {
    this.options = {
      stabilityThresholdMs: options.stabilityThresholdMs ?? 500,
      pollIntervalMs: options.pollIntervalMs ?? 100,
      debounceMs: options.debounceMs ?? DEBOUNCE_MS,
    }
  }

  startWatching(input: WorkspaceWatchInput): void {
    if (this.watchersByWorkspaceId.has(input.workspaceId)) return

    const watcher = chokidar.watch(input.workspacePath, {
      ignored: (filePath) => {
        const relative = path.relative(input.workspacePath, filePath)
        if (relative === '') return false
        const segments = relative.split(path.sep)
        const basename = segments[segments.length - 1] ?? ''
        // Skip dotfiles by default (D11 — the manager UI may still see
        // them via includeHidden, but the activity log skips them so
        // the feed isn't drowned in editor temp files / .DS_Store).
        if (basename.startsWith('.') && basename !== '.gitignore') return true
        if (segments.includes('node_modules')) return true
        if (segments[0] === '.vynel') return true
        return false
      },
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThresholdMs,
        pollInterval: this.options.pollIntervalMs,
      },
      followSymlinks: false,
      persistent: true,
    })

    watcher
      .on('add', (absPath) => this.schedule(input, absPath, 'file-created'))
      .on('change', (absPath) => this.schedule(input, absPath, 'file-edited'))
      .on('unlink', (absPath) => this.schedule(input, absPath, 'file-deleted'))
      .on('addDir', (absPath) => this.schedule(input, absPath, 'folder-created'))
      .on('unlinkDir', (absPath) => this.schedule(input, absPath, 'folder-deleted'))
      .on('error', (err) =>
        this.logger.warn({ err, workspaceId: input.workspaceId }, 'files-file-watcher error'),
      )

    this.watchersByWorkspaceId.set(input.workspaceId, watcher)
  }

  async stopWatching(workspaceId: string): Promise<void> {
    const watcher = this.watchersByWorkspaceId.get(workspaceId)
    if (!watcher) return
    this.watchersByWorkspaceId.delete(workspaceId)
    await watcher.close()
  }

  async stopAll(): Promise<void> {
    for (const timer of this.debouncedTimerByPath.values()) clearTimeout(timer)
    this.debouncedTimerByPath.clear()
    const watchers = Array.from(this.watchersByWorkspaceId.values())
    this.watchersByWorkspaceId.clear()
    await Promise.all(watchers.map((w) => w.close()))
  }

  private schedule(input: WorkspaceWatchInput, absPath: string, kind: FileActivityKind): void {
    const key = `${input.workspaceId}:${absPath}:${kind}`
    const existing = this.debouncedTimerByPath.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.debouncedTimerByPath.delete(key)
      this.record(input, absPath, kind).catch((err) =>
        this.logger.warn(
          { err, workspaceId: input.workspaceId, absPath, kind },
          'files-file-watcher record failed',
        ),
      )
    }, this.options.debounceMs)
    this.debouncedTimerByPath.set(key, timer)
  }

  private async record(
    input: WorkspaceWatchInput,
    absPath: string,
    kind: FileActivityKind,
  ): Promise<void> {
    const relative = path.relative(input.workspacePath, absPath)
    const normalizedRelativePath = relative.split(path.sep).join('/')
    const now = new Date()

    // Dedup against a recent editor:'self' row for the same path.
    // If the user-manager just wrote this file, the 'self' row is
    // already in the table; we skip the 'external' write that
    // chokidar's awaitWriteFinish delivers ~500ms-1.5s later.
    const recentSelf = findRecentSelfActivityForPath(this.db, input.workspaceId, normalizedRelativePath, {
      now,
      sinceMs: ACTIVITY_DEDUP_WINDOW_MS,
    })
    if (recentSelf) return

    // For file-created / file-edited, capture the size at observation
    // time. For deletes (no fs entry remains) + folder ops, size is
    // null. Stat may fail (race with delete) — fall back to null.
    let fileSizeBytes: number | null = null
    if (kind === 'file-created' || kind === 'file-edited') {
      try {
        const s = await stat(absPath)
        fileSizeBytes = s.size
      } catch {
        fileSizeBytes = null
      }
    }

    withTransaction(this.db, (tx) => {
      insertFileActivity(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        activityKind: kind,
        editor: 'external',
        relativePath: normalizedRelativePath,
        fromPath: null,
        fileSizeBytes,
        occurredAt: now,
      })
    })
  }
}
