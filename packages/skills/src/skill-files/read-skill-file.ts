// Opens one TEXT file of a skill for the editor (and Claude's `get_skill`).
// A binary or oversized file is refused rather than returned mangled; a
// missing one is a 404.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { NotFoundError, ValidationError } from '@vynel/errors'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveInstalledSkillFolder } from '../internal/resolve-installed-skill-folder.js'
import { assertSafeSkillFilePath } from './assert-safe-skill-file-path.js'
import { MAX_SKILL_TEXT_FILE_BYTES } from './list-skill-files.js'

export async function readSkillFile(
  installedSkill: Pick<InstalledSkillRow, 'skillId' | 'scope' | 'installLocation'>,
  relativePath: string,
  workspacePath?: string,
): Promise<{ relativePath: string; content: string }> {
  assertSafeSkillFilePath(relativePath)
  const absolutePath = path.join(
    resolveInstalledSkillFolder(installedSkill, workspacePath),
    ...relativePath.split('/'),
  )
  let sizeBytes: number
  try {
    const stats = await stat(absolutePath)
    if (!stats.isFile()) throw new NotFoundError('skill file', relativePath)
    sizeBytes = stats.size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('skill file', relativePath)
    }
    throw err
  }
  if (sizeBytes > MAX_SKILL_TEXT_FILE_BYTES) {
    throw new ValidationError(`'${relativePath}' is too large to open as text.`)
  }
  const bytes = await readFile(absolutePath)
  if (bytes.subarray(0, 8192).includes(0)) {
    throw new ValidationError(`'${relativePath}' is a binary file — it cannot be opened as text.`)
  }
  return { relativePath, content: bytes.toString('utf8') }
}
