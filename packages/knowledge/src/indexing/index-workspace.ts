// `indexWorkspace` — initial-scan core op. Walks the workspace
// directory, calls `indexFile` for every eligible file with bounded
// concurrency 4. Called once when a workspace is opened (the
// `workspace.created` outbox consumer in Cluster 7).
//
// Concurrency is bounded so a 5000-file workspace doesn't open 5000
// pdf-parse / mammoth invocations at once (each opens read FDs +
// allocates buffers; the 50 MB max-file limit caps per-file memory
// but 4 large PDFs together stays manageable).
//
// Walks skip the same prefixes the FileWatcherService ignores: dot-
// folders, `.vynel/`, `Archive/`, `node_modules/`. Identity files
// at the workspace root (USER.md / PREFERENCES.md / MEMORY.md) are
// added back because they're capital-letter files NOT starting with
// a dot.
//
// Per blueprint §8.1 + §8.5.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { indexFile } from './index-file.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../knowledge-types.js'

const INDEX_CONCURRENCY = 4

export type IndexWorkspaceInput = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export type IndexWorkspaceResult = {
  indexedCount: number
  skippedCount: number
  failedCount: number
}

export async function indexWorkspace(
  db: Database,
  input: IndexWorkspaceInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<IndexWorkspaceResult> {
  const allRelativePaths = await walkWorkspaceFiles(input.workspacePath)
  const stats: IndexWorkspaceResult = {
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
        const doc = await indexFile(db, { ...input, relativePath }, deps)
        if (doc.parseStatus === 'parsed') stats.indexedCount += 1
        else if (doc.parseStatus === 'skipped') stats.skippedCount += 1
        else if (doc.parseStatus === 'failed') stats.failedCount += 1
      } catch (err) {
        deps.logger?.warn(
          { err, relativePath, workspaceId: input.workspaceId },
          'indexWorkspace: indexFile threw',
        )
        stats.failedCount += 1
      }
    }
  })
  await Promise.all(workers)
  return stats
}

async function walkWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Directory unreadable — silently skip; the surface (a single
      // workspace folder) shouldn't surface fs errors here.
      return
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(workspacePath, absolutePath).split(path.sep).join('/')

      // Dot-files are skipped.
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
  await walk(workspacePath)
  return results
}
