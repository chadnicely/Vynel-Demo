// The uninstall disk op follows the row's installLocation (the 2026-08-26
// audit: a folder recomputed from `skillId` deleted nothing for an external
// skill whose frontmatter name differed from its folder) — and refuses,
// before touching anything, a row that points outside the skills root.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from './resolve-host-home-dir.js'
import { uninstallSkillFromDisk } from './uninstall-skill-from-disk.js'
import type { InstalledSkillRow } from '../repositories/index.js'

function makeRow(installLocation: string, overrides: Partial<InstalledSkillRow> = {}): InstalledSkillRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId: randomUUID(),
    workspaceId: null,
    skillId: 'recipe-box',
    scope: 'user',
    installedFromSource: 'external',
    versionInstalled: 'unknown',
    installLocation,
    installHealth: 'healthy',
    installHealthMessage: null,
    installedAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('uninstallSkillFromDisk — location', () => {
  it('removes the folder the row points at, whatever it is called', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-uninstall-loc-'))
    try {
      await withHomeDir(homeDir, async () => {
        const folder = join(homeDir, '.claude', 'skills', 'my-recipes')
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, 'SKILL.md'), '---\nname: recipe-box\n---\n', 'utf8')
        await uninstallSkillFromDisk({
          installedSkill: makeRow(join(folder, 'SKILL.md')),
          skillDefinition: null,
        })
        expect(existsSync(folder)).toBe(false)
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  it('refuses a row pointing outside the skills root and deletes nothing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-uninstall-loc-'))
    const elsewhere = mkdtempSync(join(tmpdir(), 'vynel-uninstall-elsewhere-'))
    try {
      await withHomeDir(homeDir, async () => {
        writeFileSync(join(elsewhere, 'SKILL.md'), 'x', 'utf8')
        await expect(
          uninstallSkillFromDisk({
            installedSkill: makeRow(join(elsewhere, 'SKILL.md')),
            skillDefinition: null,
          }),
        ).rejects.toMatchObject({ code: 'validation_failed' })
        expect(existsSync(join(elsewhere, 'SKILL.md'))).toBe(true)
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
