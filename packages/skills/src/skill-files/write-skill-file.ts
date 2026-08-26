// Writes one TEXT file into an installed skill's folder — the editor's save
// and Claude's `write_skill_file`. Creates the file (folders included) or
// replaces it. Writing `SKILL.md` is the one special case: the result must
// still be a skill Claude Code will load (`name` = the skill id, a
// `description` present), because a broken entry file silently switches
// the whole skill off. A path that runs through an existing FILE
// (`SKILL.md/x.md`) or lands on a folder is the caller's mistake (400),
// never a crash.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveInstalledSkillFolder } from '../internal/resolve-installed-skill-folder.js'
import { assertSafeSkillFilePath, isSkillEntryFile } from './assert-safe-skill-file-path.js'
import { MAX_SKILL_TEXT_FILE_BYTES } from './list-skill-files.js'
import { assertLoadableSkillMarkdown } from './skill-markdown-frontmatter.js'

export type WriteSkillFileInput = {
  relativePath: string
  content: string
}

export async function writeSkillFile(
  installedSkill: Pick<InstalledSkillRow, 'skillId' | 'scope' | 'installLocation'>,
  input: WriteSkillFileInput,
  workspacePath?: string,
): Promise<{ absolutePath: string }> {
  assertSafeSkillFilePath(input.relativePath)
  if (Buffer.byteLength(input.content, 'utf8') > MAX_SKILL_TEXT_FILE_BYTES) {
    throw new ValidationError(`'${input.relativePath}' is too large — skill files are capped at 1 MB.`)
  }
  if (isSkillEntryFile(input.relativePath)) {
    assertLoadableSkillMarkdown(input.content, installedSkill.skillId)
  }
  const absolutePath = path.join(
    resolveInstalledSkillFolder(installedSkill, workspacePath),
    ...input.relativePath.split('/'),
  )
  try {
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, input.content, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOTDIR' || code === 'EEXIST' || code === 'EISDIR') {
      throw new ValidationError(
        `'${input.relativePath}' cannot be written — a file or folder already sits on that path.`,
      )
    }
    throw err
  }
  return { absolutePath }
}
