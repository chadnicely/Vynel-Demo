// Path safety for user-registered knowledge sources. A source can point at ANY
// directory or single file the user chooses (workspace or global scope), so
// validate before indexing: it must be an absolute, existing, readable path —
// never a filesystem root or the home-directory root (indexing those would be
// a runaway) — and a single FILE must be a format the indexer can parse (a
// registered-but-forever-skipped file would look like silent failure).

import { statSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ValidationError } from '@vynel/errors'
import { deriveDocumentKindFromPath } from '@vynel/indexer'
import type { KnowledgeSourceKind } from '../schema/sources.js'

export function resolveIndexableSourceKind(absolutePath: string): KnowledgeSourceKind {
  if (!path.isAbsolute(absolutePath)) {
    throw new ValidationError('A knowledge source path must be absolute.')
  }
  const normalized = path.resolve(absolutePath)
  if (normalized === path.parse(normalized).root) {
    throw new ValidationError('Refusing to index a filesystem root as a knowledge source.')
  }
  if (normalized === path.resolve(os.homedir())) {
    throw new ValidationError('Refusing to index the home-directory root as a knowledge source.')
  }
  let stats
  try {
    stats = statSync(normalized)
  } catch {
    throw new ValidationError(`Knowledge source path does not exist: ${absolutePath}`)
  }
  try {
    accessSync(normalized, constants.R_OK)
  } catch {
    throw new ValidationError(`Knowledge source path is not readable: ${absolutePath}`)
  }

  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) {
    if (deriveDocumentKindFromPath(path.basename(normalized)) === 'unsupported') {
      throw new ValidationError(
        `This file type can't be indexed: ${path.basename(absolutePath)}. ` +
          'Supported: markdown, plain text, PDF, Word (.docx), HTML, CSV, and JSON.',
      )
    }
    return 'file'
  }
  throw new ValidationError(`Knowledge source path is not a directory or file: ${absolutePath}`)
}
