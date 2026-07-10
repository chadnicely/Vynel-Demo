// `importMemoryEntryFromFile` — "remember this file": reads + parses ONE
// on-disk document (the knowledge parser stack) and saves its text as a
// memory entry, tagged like any other. Deliberately a one-shot IMPORT, not a
// watched source: memory entries are curated facts the session snapshot can
// carry, so a big or ever-changing document belongs in Knowledge (indexed +
// searchable), not here — the size cap redirects to it in plain words. The
// watched `memory_sources` registry stays the planned follow-up
// (docs/module-notes/memory.md).

import path from 'node:path'
import { statSync, accessSync, constants } from 'node:fs'
import { ValidationError } from '@vynel/errors'
import { deriveDocumentKindFromPath, resolveDocumentParser } from '@vynel/indexer'
import type { Database } from '@vynel/db'
import type { MemoryEntry } from '../repositories/index.js'
import { createMemoryEntry } from './create-memory-entry.js'

// Standing memory rides into session context — keep an import readable-sized.
const MAX_IMPORT_CHARS = 20_000

export type ImportMemoryEntryFromFileInput = {
  userId: string
  workspaceId: string
  absolutePath: string
  tags?: string[]
}

export async function importMemoryEntryFromFile(
  db: Database,
  input: ImportMemoryEntryFromFileInput,
): Promise<MemoryEntry> {
  const { absolutePath } = input
  if (!path.isAbsolute(absolutePath)) {
    throw new ValidationError('A memory file path must be absolute.')
  }
  let stats
  try {
    stats = statSync(absolutePath)
  } catch {
    throw new ValidationError(`File not found: ${absolutePath}. Pick a file that exists.`)
  }
  if (!stats.isFile()) {
    throw new ValidationError(`${absolutePath} is not a file — folders belong in Knowledge.`)
  }
  try {
    accessSync(absolutePath, constants.R_OK)
  } catch {
    throw new ValidationError(`${absolutePath} is not readable.`)
  }

  const fileName = path.basename(absolutePath)
  const documentKind = deriveDocumentKindFromPath(fileName)
  if (documentKind === 'unsupported') {
    throw new ValidationError(
      `This file type can't be read into memory: ${fileName}. ` +
        'Supported: markdown, plain text, PDF, Word (.docx), HTML, CSV, and JSON.',
    )
  }
  const parser = resolveDocumentParser(documentKind)
  if (!parser) {
    throw new ValidationError(`No parser available for ${fileName}.`)
  }
  const parsed = await parser({ absolutePath, fileSizeBytes: stats.size })
  const text = parsed.parsedText.trim()
  if (text.length === 0) {
    throw new ValidationError(`${fileName} has no readable text to remember.`)
  }
  if (text.length > MAX_IMPORT_CHARS) {
    throw new ValidationError(
      `${fileName} is too long to hold as a single memory — add it to Knowledge instead, ` +
        'where it stays fully searchable.',
    )
  }

  return createMemoryEntry(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: 'note',
    title: fileName,
    body: text,
    category: 'memory',
    section: 'imported',
    createdSource: 'file-import',
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
  })
}
