// `createFile` — create a new empty (or seeded) file. Errors if the
// target already exists (no silent overwrite — that's writeFileContent's
// job, and even there a confirm modal is the UX gate).

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { ConflictError, ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertFileActivity } from '@vynel/db/repositories/files'
import { assertRealpathContained } from '../path/assert-realpath-contained.js'
import { MAX_EDITABLE_BYTES } from './file-content-kind.js'
import { assertWritableTarget } from '../path/path-safety.js'
import { resolveWorkspaceRelativePath } from '../path/resolve-workspace-relative-path.js'
import type { StructuralLogger } from '../files-types.js'

export type CreateFileInput = {
  workspaceId: string
  userId: string
  workspacePath: string
  relativePath: string
  content?: string
}

export async function createFile(
  db: Database,
  input: CreateFileInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ relativePath: string; fileSizeBytes: number; modifiedAt: Date }> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  assertWritableTarget(normalizedRelativePath)
  await assertRealpathContained(input.workspacePath, absolutePath)

  const content = input.content ?? ''
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_BYTES) {
    throw new ValidationError('That file is too large to create in the app.')
  }

  await mkdir(path.dirname(absolutePath), { recursive: true })
  try {
    // `wx` = write exclusive — fails if file exists.
    await writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConflictError(`A file already exists at "${normalizedRelativePath}".`)
    }
    throw err
  }

  const fileStat = await stat(absolutePath)

  try {
    withTransaction(db, (tx) => {
      insertFileActivity(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        activityKind: 'file-created',
        editor: 'self',
        relativePath: normalizedRelativePath,
        fromPath: null,
        fileSizeBytes: fileStat.size,
        occurredAt: new Date(),
      })
    })
  } catch (err) {
    deps.logger?.warn({ err, relativePath: normalizedRelativePath }, 'file activity insert failed')
  }

  return {
    relativePath: normalizedRelativePath,
    fileSizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime,
  }
}
