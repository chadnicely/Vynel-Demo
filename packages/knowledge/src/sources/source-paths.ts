// The ONE home for how a source's paths resolve, directory vs single-file:
// a directory source roots at its own path and documents key on paths relative
// to it; a FILE source roots at the file's parent directory and owns exactly
// one document, keyed on the file's basename. `indexFile`, `indexSource`, and
// the `FileWatcherService` all resolve through here — no per-caller drift.

import path from 'node:path'
import type { KnowledgeSourceRow } from '../schema/sources.js'

/** The directory a source's document `relativePath`s resolve against. */
export function sourceRootFor(source: KnowledgeSourceRow): string {
  return source.sourceKind === 'file'
    ? path.dirname(source.absolutePath)
    : source.absolutePath
}

/** A source's document key for an absolute path inside it (forward-slashed). */
export function sourceRelativePathFor(
  source: KnowledgeSourceRow,
  absolutePath: string,
): string {
  return path.relative(sourceRootFor(source), absolutePath).split(path.sep).join('/')
}
