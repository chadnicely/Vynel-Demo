// `streamFileBytes` — resolve + stat + return the absolute path +
// content-type for the route to stream raw bytes (images, PDF,
// download). Streaming is unbounded in Phase 1 (single-user-local;
// no realistic abuse vector per D-OQ-D streaming default). The route
// uses Node's createReadStream + Hono's body helpers.

import { stat } from 'node:fs/promises'
import { NotFoundError } from '@vynel/errors'
import { assertRealpathContained } from '../path/assert-realpath-contained.js'
import { contentTypeForRawResponse } from './file-content-kind.js'
import { resolveWorkspaceRelativePath } from '../path/resolve-workspace-relative-path.js'

export type StreamFileBytesInput = {
  workspacePath: string
  relativePath: string
}

export type StreamFileBytesOutput = {
  absolutePath: string
  normalizedRelativePath: string
  contentType: string
  fileSizeBytes: number
  modifiedAt: Date
}

export async function streamFileBytes(input: StreamFileBytesInput): Promise<StreamFileBytesOutput> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  await assertRealpathContained(input.workspacePath, absolutePath)

  let fileStat
  try {
    fileStat = await stat(absolutePath)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new NotFoundError('file', normalizedRelativePath)
    }
    throw cause
  }

  if (fileStat.isDirectory()) {
    // A path that resolves to a directory is not streamable — surface
    // as NotFound rather than a generic 500 from the stream layer.
    throw new NotFoundError('file', normalizedRelativePath)
  }

  return {
    absolutePath,
    normalizedRelativePath,
    contentType: contentTypeForRawResponse(normalizedRelativePath),
    fileSizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime,
  }
}
