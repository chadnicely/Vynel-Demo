// `createDirectory` — mkdir (recursive). Idempotent on existing dirs
// to mirror Finder/Explorer behavior (a recursive create over an
// existing path is a no-op rather than an error). Records
// 'folder-created' iff the target didn't previously exist.

import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { withTransaction, type Database } from '@vynel/db'
import { insertFileActivity } from '@vynel/db/repositories/files'
import { assertRealpathContained } from '../path/assert-realpath-contained.js'
import { assertWritableTarget } from '../path/path-safety.js'
import { resolveWorkspaceRelativePath } from '../path/resolve-workspace-relative-path.js'
import type { StructuralLogger } from '../files-types.js'

export type CreateDirectoryInput = {
  workspaceId: string
  userId: string
  workspacePath: string
  relativePath: string
}

export async function createDirectory(
  db: Database,
  input: CreateDirectoryInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ relativePath: string; wasCreated: boolean }> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  assertWritableTarget(normalizedRelativePath)
  await assertRealpathContained(input.workspacePath, absolutePath)

  const existed = await directoryExists(absolutePath)
  await mkdir(absolutePath, { recursive: true })

  if (!existed) {
    try {
      withTransaction(db, (tx) => {
        insertFileActivity(tx, {
          id: randomUUID(),
          userId: input.userId,
          workspaceId: input.workspaceId,
          activityKind: 'folder-created',
          editor: 'self',
          relativePath: normalizedRelativePath,
          fromPath: null,
          fileSizeBytes: null,
          occurredAt: new Date(),
        })
      })
    } catch (err) {
      deps.logger?.warn(
        { err, relativePath: normalizedRelativePath },
        'folder-created activity insert failed',
      )
    }
  }

  return { relativePath: normalizedRelativePath, wasCreated: !existed }
}

async function directoryExists(absolutePath: string): Promise<boolean> {
  try {
    const s = await stat(absolutePath)
    return s.isDirectory()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
