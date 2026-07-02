// `FileWatcherService` — the stateful infra holding one chokidar instance per
// active SOURCE (a registered directory), plus a per-path debounce timer (300 ms)
// and a per-source activity ring buffer (100 events). A class per the gate-trail
// Q6 — legitimate stateful infrastructure — living in the orchestration layer
// because it calls `indexFile` + `removeFileFromIndex`.
//
// Methods:
//   - startWatchingSource(source)        — open a chokidar watcher for a source
//   - stopWatchingSource(sourceId)       — close that source's watcher
//   - stopWatchingWorkspace(workspaceId) — close every watcher of a workspace
//   - stopAll()                          — close every open watcher (shutdown)
//   - getActivityForSource(sourceId)     — read the ring buffer
//
// Key behaviors: 300 ms per-path debounce; `awaitWriteFinish` guards half-written
// files; `followSymlinks: false`; `ignoreInitial: true` (the initial walk is
// `indexSource`'s job); hard-skip dotfiles / `.vynel/**` / `Archive/**` /
// `node_modules/**`. Activity ring is in-memory only, cleared on restart.
// Per blueprint §7.

import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { indexFile } from './index-file.js'
import { removeFileFromIndex } from './remove-file-from-index.js'
import type { Database } from '@vynel/db'
import type { KnowledgeSourceRow } from '../repositories/index.js'
import type { ActivityEvent, StructuralLogger } from '../knowledge-types.js'

const DEBOUNCE_MS = 300
const MAX_ACTIVITY_PER_SOURCE = 100

type ActiveWatcher = { watcher: FSWatcher; workspaceId: string | null }

export class FileWatcherService {
  private readonly watchersBySourceId = new Map<string, ActiveWatcher>()
  private readonly debouncedTimerByPath = new Map<string, NodeJS.Timeout>()
  private readonly activityBySourceId = new Map<string, ActivityEvent[]>()

  constructor(
    private readonly db: Database,
    private readonly logger: StructuralLogger,
  ) {}

  startWatchingSource(source: KnowledgeSourceRow): void {
    if (this.watchersBySourceId.has(source.id)) return

    const watcher = chokidar.watch(source.absolutePath, {
      ignored: (filePath) => {
        const relative = path.relative(source.absolutePath, filePath)
        if (relative === '') return false
        const segments = relative.split(path.sep)
        const basename = segments[segments.length - 1] ?? ''
        if (basename.startsWith('.')) return true
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

    watcher
      .on('add', (absPath) => this.scheduleIndex(source, absPath, 'added'))
      .on('change', (absPath) => this.scheduleIndex(source, absPath, 'changed'))
      .on('unlink', (absPath) => this.scheduleRemove(source, absPath))
      .on('error', (err) => this.logger.warn({ err, sourceId: source.id }, 'file-watcher error'))

    this.watchersBySourceId.set(source.id, { watcher, workspaceId: source.workspaceId })
  }

  async stopWatchingSource(sourceId: string): Promise<void> {
    const active = this.watchersBySourceId.get(sourceId)
    if (!active) return
    await active.watcher.close()
    this.watchersBySourceId.delete(sourceId)
  }

  async stopWatchingWorkspace(workspaceId: string): Promise<void> {
    const ids = Array.from(this.watchersBySourceId.entries())
      .filter(([, active]) => active.workspaceId === workspaceId)
      .map(([id]) => id)
    await Promise.all(ids.map((id) => this.stopWatchingSource(id)))
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.watchersBySourceId.keys())
    await Promise.all(ids.map((id) => this.stopWatchingSource(id)))
    for (const handle of this.debouncedTimerByPath.values()) clearTimeout(handle)
    this.debouncedTimerByPath.clear()
  }

  getActivityForSource(sourceId: string): readonly ActivityEvent[] {
    return this.activityBySourceId.get(sourceId) ?? []
  }

  private scheduleIndex(
    source: KnowledgeSourceRow,
    absolutePath: string,
    kind: 'added' | 'changed',
  ): void {
    this.debounce(absolutePath, async () => {
      const normalized = path.relative(source.absolutePath, absolutePath).split(path.sep).join('/')
      try {
        await indexFile(this.db, { source, relativePath: normalized }, { logger: this.logger })
        this.recordActivity(source.id, {
          at: new Date(),
          sourceId: source.id,
          eventKind: kind,
          relativePath: normalized,
        })
      } catch (err) {
        this.recordActivity(source.id, {
          at: new Date(),
          sourceId: source.id,
          eventKind: 'parse-failed',
          relativePath: normalized,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        this.logger.warn(
          { err, relativePath: normalized, sourceId: source.id },
          'failed to index file from watch event',
        )
      }
    })
  }

  private scheduleRemove(source: KnowledgeSourceRow, absolutePath: string): void {
    this.debounce(absolutePath, async () => {
      const normalized = path.relative(source.absolutePath, absolutePath).split(path.sep).join('/')
      try {
        removeFileFromIndex(this.db, { source, relativePath: normalized })
        this.recordActivity(source.id, {
          at: new Date(),
          sourceId: source.id,
          eventKind: 'removed',
          relativePath: normalized,
        })
      } catch (err) {
        this.logger.warn(
          { err, relativePath: normalized, sourceId: source.id },
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

  private recordActivity(sourceId: string, event: ActivityEvent): void {
    const ring = this.activityBySourceId.get(sourceId) ?? []
    ring.push(event)
    if (ring.length > MAX_ACTIVITY_PER_SOURCE) ring.shift()
    this.activityBySourceId.set(sourceId, ring)
  }
}
