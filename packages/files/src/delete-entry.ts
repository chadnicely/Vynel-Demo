// `deleteEntry` — hard delete a file or directory. Per D3: hard delete
// behind a confirm modal (the confirm is a frontend concern); the
// approval-card system is not used (D4 — user-initiated ops).
//
// Recursive flag required for non-empty directories. Refuses `.vynel/`
// + the workspace root via assertWritableTarget. Records
// 'file-deleted' or 'folder-deleted' based on what was removed.

import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertFileActivity } from '@vynel/db/repositories/files'
import { assertRealpathContained } from './assert-realpath-contained.js'
import { assertWritableTarget } from './path-safety.js'
import { resolveWorkspaceRelativePath } from './resolve-workspace-relative-path.js'
import type { StructuralLogger } from './files-types.js'

export type DeleteEntryInput = {
  workspaceId: string
  userId: string
  workspacePath: string
  relativePath: string
  recursive?: boolean
}

export async function deleteEntry(
  db: Database,
  input: DeleteEntryInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ relativePath: string; kind: 'file' | 'directory' }> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  assertWritableTarget(normalizedRelativePath)
  await assertRealpathContained(input.workspacePath, absolutePath)

  let entryStat
  try {
    entryStat = await stat(absolutePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('file', normalizedRelativePath)
    }
    throw err
  }

  const kind: 'file' | 'directory' = entryStat.isDirectory() ? 'directory' : 'file'
  const recursive = input.recursive ?? false

  if (kind === 'directory' && !recursive) {
    // Refuse the destructive shorthand — require explicit recursive
    // for non-empty dirs (the UI shows a confirm modal that names
    // the recursive intent).
    throw new ConflictError(
      `Folder "${normalizedRelativePath}" is a directory. Pass recursive: true to delete it.`,
    )
  }

  await rm(absolutePath, { recursive, force: false })

  try {
    withTransaction(db, (tx) => {
      insertFileActivity(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        activityKind: kind === 'directory' ? 'folder-deleted' : 'file-deleted',
        editor: 'self',
        relativePath: normalizedRelativePath,
        fromPath: null,
        fileSizeBytes: null,
        occurredAt: new Date(),
      })
    })
  } catch (err) {
    deps.logger?.warn({ err, relativePath: normalizedRelativePath }, 'delete activity insert failed')
  }

  return { relativePath: normalizedRelativePath, kind }
}
