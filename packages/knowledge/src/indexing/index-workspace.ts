// `indexSource` — initial-scan core op for a SOURCE (a registered directory at
// workspace or global scope). Walks the source's `absolutePath`, calls `indexFile`
// for every eligible file with bounded concurrency 4. Called by
// `handleWorkspaceCreated` (the workspace's own source) + `forceReindexWorkspace`
// + source registration.
//
// (The file keeps its `index-workspace.ts` name; the op generalized from
// per-workspace to per-source when knowledge gained scope + sources.)
//
// Concurrency is bounded so a 5000-file directory doesn't open 5000 pdf-parse /
// mammoth invocations at once (each opens read FDs + allocates buffers; the 50 MB
// max-file limit caps per-file memory but 4 large PDFs together stays manageable).
//
// Walks skip the same prefixes the FileWatcherService ignores: dot-folders,
// `.vynel/`, `Archive/`, `node_modules/`. Per blueprint §8.1 + §8.5.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { indexFile } from './index-file.js'
import type { Database } from '@vynel/db'
import type { KnowledgeSourceRow } from '@vynel/db/repositories/knowledge'
import type { StructuralLogger } from '../knowledge-types.js'

const INDEX_CONCURRENCY = 4

export type IndexSourceResult = {
  indexedCount: number
  skippedCount: number
  failedCount: number
}

export async function indexSource(
  db: Database,
  source: KnowledgeSourceRow,
  deps: { logger?: StructuralLogger } = {},
): Promise<IndexSourceResult> {
  const allRelativePaths = await walkSourceFiles(source.absolutePath)
  const stats: IndexSourceResult = {
    indexedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  }
  const queue = [...allRelativePaths]
  const workers = Array.from({ length: INDEX_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const relativePath = queue.shift()
      if (!relativePath) break
      try {
        const doc = await indexFile(db, { source, relativePath }, deps)
        if (doc.parseStatus === 'parsed') stats.indexedCount += 1
        else if (doc.parseStatus === 'skipped') stats.skippedCount += 1
        else if (doc.parseStatus === 'failed') stats.failedCount += 1
      } catch (err) {
        deps.logger?.warn(
          { err, relativePath, sourceId: source.id },
          'indexSource: indexFile threw',
        )
        stats.failedCount += 1
      }
    }
  })
  await Promise.all(workers)
  return stats
}

async function walkSourceFiles(rootPath: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Directory unreadable — silently skip; the scan shouldn't surface fs errors.
      return
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/')

      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue
      if (relativePath.startsWith('Archive/') || relativePath === 'Archive') continue
      if (relativePath.startsWith('.vynel/') || relativePath === '.vynel') continue

      if (entry.isDirectory()) {
        await walk(absolutePath)
      } else if (entry.isFile()) {
        results.push(relativePath)
      }
    }
  }
  await walk(rootPath)
  return results
}
