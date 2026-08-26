// The skill-folder doors over a real isolated home + workspace dir: the
// folder comes from the row's installLocation (not the skillId), the path
// wall refuses anything that could leave the folder or masquerade as the
// entry file, list/read/write/delete round-trip supporting files (nested
// folders tidied on delete), binary files are listed but never opened, and
// a SKILL.md write must still be a loadable skill.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { resolveInstalledSkillFolder } from '../internal/resolve-installed-skill-folder.js'
import { assertSafeSkillFilePath } from './assert-safe-skill-file-path.js'
import { listSkillFiles } from './list-skill-files.js'
import { readSkillFile } from './read-skill-file.js'
import { writeSkillFile } from './write-skill-file.js'
import { deleteSkillFile } from './delete-skill-file.js'
import {
  assertLoadableSkillMarkdown,
  parseSkillMarkdownFrontmatter,
  renderSkillMarkdown,
} from './skill-markdown-frontmatter.js'

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skill-files-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-skill-files-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

const SKILL_MD = '---\nname: recipe-box\ndescription: Find and format recipes\n---\n\nLook things up.\n'

function seedSkill(homeDir: string, folderName: string) {
  const folder = join(homeDir, '.claude', 'skills', folderName)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), SKILL_MD, 'utf8')
  return {
    skillId: 'recipe-box',
    scope: 'user' as const,
    installLocation: join(folder, 'SKILL.md'),
  }
}

describe('resolveInstalledSkillFolder', () => {
  it('follows installLocation even when the folder name differs from the skillId', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const row = seedSkill(homeDir, 'my-recipes')
      expect(resolveInstalledSkillFolder(row)).toBe(join(homeDir, '.claude', 'skills', 'my-recipes'))
    })
  })

  it('refuses a row whose location sits outside the scope root or nests deeper', async () => {
    await withIsolatedDirs(async (homeDir, workspaceDir) => {
      const row = seedSkill(homeDir, 'ok')
      expect(() =>
        resolveInstalledSkillFolder({ ...row, installLocation: join(workspaceDir, 'x', 'SKILL.md') }),
      ).toThrow(/outside/)
      expect(() =>
        resolveInstalledSkillFolder({
          ...row,
          installLocation: join(homeDir, '.claude', 'skills', 'a', 'b', 'SKILL.md'),
        }),
      ).toThrow(/outside/)
      expect(() =>
        resolveInstalledSkillFolder({
          ...row,
          installLocation: join(homeDir, '.claude', 'skills', 'SKILL.md'),
        }),
      ).toThrow(/outside/)
    })
  })
})

describe('assertSafeSkillFilePath', () => {
  it('accepts nested relative paths and refuses escapes, hidden names and SKILL.md look-alikes', () => {
    expect(() => assertSafeSkillFilePath('references/style.md')).not.toThrow()
    expect(() => assertSafeSkillFilePath('SKILL.md')).not.toThrow()
    expect(() => assertSafeSkillFilePath('skill.md')).toThrow(/spelled/)
    expect(() => assertSafeSkillFilePath('../escape.md')).toThrow(/unsafe part/)
    expect(() => assertSafeSkillFilePath('/abs.md')).toThrow(/unsafe part/)
    expect(() => assertSafeSkillFilePath('a\\b.md')).toThrow(/forward slashes/)
    expect(() => assertSafeSkillFilePath('.hidden')).toThrow(/unsafe part/)
    expect(() => assertSafeSkillFilePath('a/b/c/d/e/f/g.md')).toThrow(/deep/)
    expect(() => assertSafeSkillFilePath('')).toThrow(/characters/)
    // Windows-reserved: a colon would write an NTFS alternate data stream.
    expect(() => assertSafeSkillFilePath('notes:draft.md')).toThrow(/unsafe part/)
    expect(() => assertSafeSkillFilePath('what?.md')).toThrow(/unsafe part/)
  })
})

describe('list / read / write / delete', () => {
  it('round-trips a supporting file, lists SKILL.md first, and tidies emptied folders', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const row = seedSkill(homeDir, 'recipe-box')
      await writeSkillFile(row, { relativePath: 'references/units.md', content: '# Units\n' })
      writeFileSync(join(homeDir, '.claude', 'skills', 'recipe-box', 'logo.png'), Buffer.from([0x89, 0x50, 0, 0x47]))

      expect(listSkillFiles(row)).toEqual([
        { relativePath: 'SKILL.md', sizeBytes: SKILL_MD.length, isText: true },
        { relativePath: 'logo.png', sizeBytes: 4, isText: false },
        { relativePath: 'references/units.md', sizeBytes: 8, isText: true },
      ])
      expect(await readSkillFile(row, 'references/units.md')).toEqual({
        relativePath: 'references/units.md',
        content: '# Units\n',
      })
      await expect(readSkillFile(row, 'logo.png')).rejects.toMatchObject({
        code: 'validation_failed',
      })
      await expect(readSkillFile(row, 'missing.md')).rejects.toMatchObject({ code: 'not_found' })

      // A folder is not a file — never a recursive delete.
      await expect(deleteSkillFile(row, 'references')).rejects.toMatchObject({ code: 'not_found' })
      // A path through an existing file is the caller's mistake, not a crash.
      await expect(
        writeSkillFile(row, { relativePath: 'SKILL.md/x.md', content: 'x' }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      await deleteSkillFile(row, 'references/units.md')
      expect(existsSync(join(homeDir, '.claude', 'skills', 'recipe-box', 'references'))).toBe(false)
      await expect(deleteSkillFile(row, 'references/units.md')).rejects.toMatchObject({
        code: 'not_found',
      })
    })
  })

  it('refuses to delete SKILL.md and refuses a SKILL.md write that would not load', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const row = seedSkill(homeDir, 'recipe-box')
      await expect(deleteSkillFile(row, 'SKILL.md')).rejects.toMatchObject({
        code: 'validation_failed',
      })
      await expect(
        writeSkillFile(row, { relativePath: 'SKILL.md', content: '# No frontmatter\n' }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
      await expect(
        writeSkillFile(row, {
          relativePath: 'SKILL.md',
          content: '---\nname: other-name\ndescription: x\n---\nBody',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      await writeSkillFile(row, {
        relativePath: 'SKILL.md',
        content: '---\nname: recipe-box\ndescription: "Better"\n---\n\nNew body.\n',
      })
      expect(readFileSync(row.installLocation, 'utf8')).toContain('New body.')
    })
  })
})

describe('SKILL.md frontmatter', () => {
  it('renders name + description and parses them back (BOM/CRLF tolerant)', () => {
    const markdown = renderSkillMarkdown({
      skillId: 'recipe-box',
      description: 'Find: recipes',
      body: '\n\nLook things up.\n\n',
    })
    expect(markdown).toBe(
      '---\nname: recipe-box\ndescription: "Find: recipes"\n---\n\nLook things up.\n',
    )
    expect(parseSkillMarkdownFrontmatter(markdown)).toEqual({
      name: 'recipe-box',
      description: 'Find: recipes',
    })
    expect(parseSkillMarkdownFrontmatter('﻿---\r\nname: a\r\ndescription: b\r\n---\r\nx')).toEqual(
      { name: 'a', description: 'b' },
    )
    expect(() => assertLoadableSkillMarkdown(markdown, 'recipe-box')).not.toThrow()
    expect(() => assertLoadableSkillMarkdown('---\nname: recipe-box\n---\nx', 'recipe-box')).toThrow(
      /description/,
    )
  })
})
