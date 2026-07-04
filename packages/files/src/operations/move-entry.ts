// `moveEntry` — rename or move a file/directory. Both `fromPath` and
// `toPath` validated in-workspace; refuses to overwrite an existing
// target unless `overwrite: true`. Records 'file-moved' (covers both
// rename within the same parent and move across parents).

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, rename, stat } from 'node:fs/promises'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertFileActivity } from '@vynel/db/repositories/files'
import { assertRealpathContained } from '../path/assert-realpath-contained.js'
import { assertWritableTarget } from '../path/path-safety.js'
import { resolveWorkspaceRelativePath } from '../path/resolve-workspace-relative-path.js'
import type { StructuralLogger } from '../files-types.js'

export type MoveEntryInput = {
  workspaceId: string
  userId: string
  workspacePath: string
  fromPath: string
  toPath: string
  overwrite?: boolean
}

export async function moveEntry(
  db: Database,
  input: MoveEntryInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ fromPath: string; toPath: string }> {
  const from = resolveWorkspaceRelativePath(input.workspacePath, input.fromPath)
  const to = resolveWorkspaceRelativePath(input.workspacePath, input.toPath)
  assertWritableTarget(to.normalizedRelativePath)
  await assertRealpathContained(input.workspacePath, from.absolutePath)
  await assertRealpathContained(input.workspacePath, to.absolutePath)

  // Source must exist.
  let fromStat
  try {
    fromStat = await stat(from.absolutePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('file', from.normalizedRelativePath)
    }
    throw err
  }

  // Refuse to clobber an existing target by default. SF3: don't throw
  // inside the try block (the catch's `code !== 'ENOENT'` would
  // happily re-throw the ConflictError because its `code` is undefined,
  // which works by accident; lift the throw out so the intent is plain).
  const overwrite = input.overwrite ?? false
  if (!overwrite) {
    let targetExists = false
    try {
      await stat(to.absolutePath)
      targetExists = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (targetExists) {
      throw new ConflictError(
        `A file or folder already exists at "${to.normalizedRelativePath}".`,
      )
    }
  }

  await mkdir(path.dirname(to.absolutePath), { recursive: true })
  await rename(from.absolutePath, to.absolutePath)

  try {
    withTransaction(db, (tx) => {
      insertFileActivity(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        activityKind: 'file-moved',
        editor: 'self',
        relativePath: to.normalizedRelativePath,
        fromPath: from.normalizedRelativePath,
        // For files, record the post-move size; for directories, null.
        fileSizeBytes: fromStat.isFile() ? fromStat.size : null,
        occurredAt: new Date(),
      })
    })
  } catch (err) {
    deps.logger?.warn(
      { err, fromPath: from.normalizedRelativePath, toPath: to.normalizedRelativePath },
      'file-moved activity insert failed',
    )
  }

  return { fromPath: from.normalizedRelativePath, toPath: to.normalizedRelativePath }
}
