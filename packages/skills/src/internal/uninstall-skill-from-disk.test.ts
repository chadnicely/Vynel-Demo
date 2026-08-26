// Integration tests for `uninstallSkillFromDisk`. Real filesystem
// under `os.tmpdir()`. Split from `install-skill-on-disk.test.ts`
// per structure-standard.md "File size cap" (code-reviewer C1).

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { installSkillOnDisk } from './install-skill-on-disk.js'
import { uninstallSkillFromDisk } from './uninstall-skill-from-disk.js'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { InstalledSkillRow } from '../repositories/index.js'

async function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-uninstall-disk-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function makeDefinition(overrides: Partial<VerifiedSkillDefinition> = {}): VerifiedSkillDefinition {
  return {
    skillId: 'email-drafter',
    displayName: 'Email Drafter',
    oneLineDescription: 'test',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    recommendedScope: 'user',
    isSystemInstalled: false,
    skillMarkdownTemplate: 'Sign-off: {{settings.defaultSignOff}}',
    requiredMcpServers: [],
    settingsSchema: [],
    ...overrides,
  }
}

function makeInstalledSkillRow(
  scope: 'user' | 'workspace',
  overrides: Partial<InstalledSkillRow> = {},
): InstalledSkillRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId: randomUUID(),
    workspaceId: scope === 'user' ? null : randomUUID(),
    skillId: 'email-drafter',
    scope,
    installedFromSource: 'verified-catalog',
    versionInstalled: '1.0.0',
    installLocation: '/never-used-in-test',
    installHealth: 'healthy',
    installHealthMessage: null,
    installedAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('uninstallSkillFromDisk (workspace scope)', () => {
  it('removes the skill folder', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const installed = await installSkillOnDisk({
        skillDefinition: makeDefinition(),
        scope: 'workspace',
        workspacePath,
        resolvedSettings: {},
      })
      expect(existsSync(installed.installLocation)).toBe(true)

      await uninstallSkillFromDisk({
        installedSkill: makeInstalledSkillRow('workspace', {
          scope: 'workspace',
          installLocation: installed.installLocation,
        }),
        skillDefinition: makeDefinition(),
        workspacePath,
      })

      expect(existsSync(installed.installLocation)).toBe(false)
      expect(existsSync(join(workspacePath, '.claude', 'skills', 'email-drafter'))).toBe(false)
    })
  })

  it('is idempotent — does not throw when the folder is already gone', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await expect(
        uninstallSkillFromDisk({
          installedSkill: makeInstalledSkillRow('workspace', {
            installLocation: join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md'),
          }),
          skillDefinition: makeDefinition(),
          workspacePath,
        }),
      ).resolves.toBeUndefined()
    })
  })

  it("removes the skill's MCP server entries when definition is supplied", async () => {
    await withTempWorkspace(async (workspacePath) => {
      const def = makeDefinition({
        requiredMcpServers: [
          { serverName: 'gmail', transport: 'stdio', commandOrUrl: 'c', args: [], environment: {} },
        ],
      })
      await installSkillOnDisk({
        skillDefinition: def,
        scope: 'workspace',
        workspacePath,
        resolvedSettings: {},
      })
      const mcpPath = join(workspacePath, '.mcp.json')
      let config = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(config.mcpServers.gmail).toBeDefined()

      await uninstallSkillFromDisk({
        installedSkill: makeInstalledSkillRow('workspace', {
            installLocation: join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md'),
          }),
        skillDefinition: def,
        workspacePath,
      })

      config = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(config.mcpServers.gmail).toBeUndefined()
    })
  })

  it("leaves a hand-added (unmarked) server matching a required server's name", async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      const handMade = { type: 'stdio', command: 'my-gmail', args: [], env: {} }
      await writeFile(mcpPath, JSON.stringify({ mcpServers: { gmail: handMade } }), 'utf8')

      await uninstallSkillFromDisk({
        installedSkill: makeInstalledSkillRow('workspace', {
            installLocation: join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md'),
          }),
        skillDefinition: makeDefinition({
          requiredMcpServers: [
            { serverName: 'gmail', transport: 'stdio', commandOrUrl: 'c', args: [], environment: {} },
          ],
        }),
        workspacePath,
      })

      const config = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(config.mcpServers.gmail).toEqual(handMade)
    })
  })

  it('skips MCP cleanup when definition is null (external skill)', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      await writeFile(
        mcpPath,
        JSON.stringify({ mcpServers: { user_owned: { command: 'k', args: [], env: {} } } }),
        'utf8',
      )

      await uninstallSkillFromDisk({
        installedSkill: makeInstalledSkillRow('workspace', {
            installLocation: join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md'),
          }),
        skillDefinition: null,
        workspacePath,
      })

      const config = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(config.mcpServers.user_owned).toBeDefined()
    })
  })
})
