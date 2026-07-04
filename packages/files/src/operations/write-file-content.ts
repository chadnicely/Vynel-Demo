// `writeFileContent` — save an edited (or new) text file. Validates
// path + size, ensures the parent directory exists, writes UTF-8,
// records a `file-edited` (or `file-created` if it didn't previously
// exist) activity row with `editor: 'self'`.
//
// Activity-log durability is best-effort (D7) — the fs mutation is
// the user's intended outcome; an activity insert failure logs a
// warning and still returns success.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertFileActivity } from '@vynel/db/repositories/files'
import { assertRealpathContained } from '../path/assert-realpath-contained.js'
import { MAX_EDITABLE_BYTES } from './file-content-kind.js'
import { assertWritableTarget } from '../path/path-safety.js'
import { resolveWorkspaceRelativePath } from '../path/resolve-workspace-relative-path.js'
import type { StructuralLogger } from '../files-types.js'

export type WriteFileContentInput = {
  workspaceId: string
  userId: string
  workspacePath: string
  relativePath: string
  content: string
}

export type WriteFileContentResult = {
  relativePath: string
  fileSizeBytes: number
  modifiedAt: Date
  wasCreated: boolean
}

export async function writeFileContent(
  db: Database,
  input: WriteFileContentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<WriteFileContentResult> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  assertWritableTarget(normalizedRelativePath)
  await assertRealpathContained(input.workspacePath, absolutePath)

  const byteLength = Buffer.byteLength(input.content, 'utf8')
  if (byteLength > MAX_EDITABLE_BYTES) {
    throw new ValidationError('That file is too large to edit in the app.')
  }

  const existed = await fileExists(absolutePath)
  // Ensure the parent directory exists — saving to a file under a
  // not-yet-created folder shouldn't 500.
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.content, 'utf8')
  const fileStat = await stat(absolutePath)

  try {
    withTransaction(db, (tx) => {
      insertFileActivity(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        activityKind: existed ? 'file-edited' : 'file-created',
        editor: 'self',
        relativePath: normalizedRelativePath,
        fromPath: null,
        fileSizeBytes: fileStat.size,
        occurredAt: new Date(),
      })
    })
  } catch (err) {
    // The file IS written — an audit-row hiccup must not fail the
    // user's save or reverse the write. Log + continue (D7).
    deps.logger?.warn({ err, relativePath: normalizedRelativePath }, 'file activity insert failed')
  }

  return {
    relativePath: normalizedRelativePath,
    fileSizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime,
    wasCreated: !existed,
  }
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const s = await stat(absolutePath)
    return s.isFile()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
