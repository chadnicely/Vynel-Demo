// `readFileContent` — read a file for preview/edit. Text kinds
// (markdown / plain-text) return UTF-8 content truncated at the
// editable cap (1 MB per D12); binary kinds (image / pdf / unsupported)
// return metadata only and the UI uses /raw to fetch the bytes.
//
// On a UTF-8 decode failure for a presumed-text file, falls back to
// 'unsupported' so the UI shows a download link instead of garbled text.

import { readFile, stat } from 'node:fs/promises'
import { NotFoundError } from '@vynel/errors'
import { assertRealpathContained } from './assert-realpath-contained.js'
import { MAX_EDITABLE_BYTES, deriveFileContentKind, isTextKind } from './file-content-kind.js'
import { resolveWorkspaceRelativePath } from './resolve-workspace-relative-path.js'
import type { FileContent } from './files-types.js'

export type ReadFileContentInput = {
  workspacePath: string
  relativePath: string
}

export async function readFileContent(input: ReadFileContentInput): Promise<FileContent> {
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

  const kind = deriveFileContentKind(normalizedRelativePath)
  const fileSizeBytes = fileStat.size
  const modifiedAt = fileStat.mtime

  if (!isTextKind(kind)) {
    return {
      relativePath: normalizedRelativePath,
      kind,
      isText: false,
      content: null,
      fileSizeBytes,
      modifiedAt,
      isTruncated: false,
    }
  }

  // Text file — read up to the editable cap. Anything larger gets
  // truncated content (so the preview still shows the top of the file)
  // + isTruncated: true so the UI disables save.
  const isTruncated = fileSizeBytes > MAX_EDITABLE_BYTES
  const readBytes = isTruncated ? MAX_EDITABLE_BYTES : fileSizeBytes

  // Read raw bytes first so we can validate UTF-8; readFile(utf8)
  // silently replaces invalid sequences with U+FFFD which would mask
  // a real binary file.
  const buffer = await readFile(absolutePath)
  const slice = buffer.subarray(0, readBytes)

  // Best-effort UTF-8 decode validity check via TextDecoder + fatal:true.
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const content = decoder.decode(slice)
    return {
      relativePath: normalizedRelativePath,
      kind,
      isText: true,
      content,
      fileSizeBytes,
      modifiedAt,
      isTruncated,
    }
  } catch {
    // The extension suggested text but the bytes aren't UTF-8 — fall
    // back to unsupported so the UI offers download instead of garbage.
    return {
      relativePath: normalizedRelativePath,
      kind: 'unsupported',
      isText: false,
      content: null,
      fileSizeBytes,
      modifiedAt,
      isTruncated: false,
    }
  }
}
