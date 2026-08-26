// Vynel's `.vynel/` metadata dir inside a workspace folder — created before
// the workspace row is written, ASYNC and outside the transaction. The
// 2026-08-26 live walk showed a filter driver (Defender's Controlled Folder
// Access) can stall a synchronous mkdir under `Documents` for minutes with the
// main thread stuck in native code — a sync mkdir inside the transaction body
// froze every room. `fs/promises` keeps the wait off the main thread; an
// ensure that fails still means no row, and a transaction refused AFTER it is
// the caller's to clean — the created-path return is how it knows what to
// take back.
//
// Idempotent (`recursive: true`); the user's own folder layout is untouched —
// only Vynel's metadata dir is created. Identity files are retired (A2);
// workspace context now lives in structured memory.

import path from 'node:path'
import { mkdir } from 'node:fs/promises'

/**
 * Returns the metadata dir's path when THIS call created it, null when it was
 * already there — so a caller that must take back exactly what it added on
 * failure (the scaffold) knows whether `.vynel/` is its to remove. Callers
 * validate the workspace folder EXISTS first: recursive mkdir would otherwise
 * mint the folder itself and defeat the existing-directory guard.
 */
export async function ensureWorkspaceMetadataDirectory(
  workspaceDirectory: string,
): Promise<string | null> {
  const metadataDirectory = path.join(workspaceDirectory, '.vynel')
  const created = await mkdir(metadataDirectory, { recursive: true })
  return created === undefined ? null : metadataDirectory
}
