// Removes one supporting file from an installed skill's folder — the
// editor's delete and Claude's `delete_skill_file`. `SKILL.md` is refused:
// removing the entry file IS uninstalling, and that door (which also drops
// the row) is `uninstallSkill`. A folder is not a file — naming one is a
// 404, never a recursive delete. An emptied subfolder is tidied away up
// to, never including, the skill folder.

import { rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { NotFoundError, ValidationError } from '@vynel/errors'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveInstalledSkillFolder } from '../internal/resolve-installed-skill-folder.js'
import { assertSafeSkillFilePath, isSkillEntryFile } from './assert-safe-skill-file-path.js'

export async function deleteSkillFile(
  installedSkill: Pick<InstalledSkillRow, 'skillId' | 'scope' | 'installLocation'>,
  relativePath: string,
  workspacePath?: string,
): Promise<void> {
  assertSafeSkillFilePath(relativePath)
  if (isSkillEntryFile(relativePath)) {
    throw new ValidationError('SKILL.md is the skill itself — uninstall the skill to remove it.')
  }
  const skillFolder = resolveInstalledSkillFolder(installedSkill, workspacePath)
  const absolutePath = path.join(skillFolder, ...relativePath.split('/'))
  try {
    const stats = await stat(absolutePath)
    if (!stats.isFile()) throw new NotFoundError('skill file', relativePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('skill file', relativePath)
    }
    throw err
  }
  await rm(absolutePath, { force: true })

  let current = path.dirname(absolutePath)
  while (current !== skillFolder && current.startsWith(skillFolder)) {
    try {
      await rmdir(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}
