// Integration tests for the FS-touching installer helpers. Real
// filesystem under `os.tmpdir()` — never touches the real
// `~/.claude/skills/` (each test gets a fresh temp dir).

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { installSkillOnDisk } from './install-skill-on-disk.js'
import { uninstallSkillFromDisk } from './uninstall-skill-from-disk.js'
import { updateMcpServersForScope } from './update-mcp-servers-for-scope.js'
import { checkInstallLocationExists } from './check-install-location-exists.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'
import { resolveMcpConfigPath } from './resolve-mcp-config-path.js'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { InstalledSkillRow } from '../repositories/index.js'

async function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-skills-fs-test-'))
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

describe('resolveSkillsRoot', () => {
  it('returns workspace .claude/skills for workspace scope', () => {
    // Use a real tmpdir-based path so the test is platform-agnostic
    // (Windows `path.join` produces backslash-separated paths).
    const wp = join(tmpdir(), 'vynel-test-resolve')
    const root = resolveSkillsRoot('workspace', wp)
    expect(root).toBe(join(wp, '.claude', 'skills'))
  })

  it('throws when workspace scope is missing workspacePath', () => {
    expect(() => resolveSkillsRoot('workspace')).toThrow(/workspacePath required/)
  })

  it('returns a user-home path for user scope', () => {
    const root = resolveSkillsRoot('user')
    expect(root.endsWith(join('.claude', 'skills'))).toBe(true)
  })
})

describe('resolveMcpConfigPath', () => {
  it('returns workspace .mcp.json for workspace scope', () => {
    const wp = join(tmpdir(), 'vynel-test-resolve-mcp')
    const p = resolveMcpConfigPath('workspace', wp)
    expect(p).toBe(join(wp, '.mcp.json'))
  })

  it('returns ~/.claude.json for user scope', () => {
    const p = resolveMcpConfigPath('user')
    expect(p.endsWith('.claude.json')).toBe(true)
  })
})

describe('checkInstallLocationExists', () => {
  it('returns true for an existing file', async () => {
    await withTempWorkspace(async (dir) => {
      const file = join(dir, 'present')
      await writeFile(file, 'x', 'utf8')
      expect(await checkInstallLocationExists(file)).toBe(true)
    })
  })

  it('returns false for a missing file', async () => {
    await withTempWorkspace(async (dir) => {
      expect(await checkInstallLocationExists(join(dir, 'missing'))).toBe(false)
    })
  })
})

describe('installSkillOnDisk (workspace scope)', () => {
  it('writes the SKILL.md at the expected path with rendered settings', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const result = await installSkillOnDisk({
        skillDefinition: makeDefinition(),
        scope: 'workspace',
        workspacePath,
        resolvedSettings: { defaultSignOff: 'Cheers,' },
      })

      const expectedPath = join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md')
      expect(result.installLocation).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)
      const content = await readFile(expectedPath, 'utf8')
      expect(content).toContain('Sign-off: Cheers,')
    })
  })

  it('creates the .claude/skills folder if it does not exist', async () => {
    await withTempWorkspace(async (workspacePath) => {
      expect(existsSync(join(workspacePath, '.claude'))).toBe(false)
      await installSkillOnDisk({
        skillDefinition: makeDefinition(),
        scope: 'workspace',
        workspacePath,
        resolvedSettings: { defaultSignOff: 'Best,' },
      })
      expect(existsSync(join(workspacePath, '.claude', 'skills', 'email-drafter'))).toBe(true)
    })
  })

  it('writes an MCP config file when requiredMcpServers is non-empty', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await installSkillOnDisk({
        skillDefinition: makeDefinition({
          requiredMcpServers: [
            {
              serverName: 'gmail',
              transport: 'stdio',
              commandOrUrl: 'node',
              args: ['./gmail-mcp.js'],
              environment: { GMAIL_TOKEN: 'x' },
            },
          ],
        }),
        scope: 'workspace',
        workspacePath,
        resolvedSettings: {},
      })

      const mcpPath = join(workspacePath, '.mcp.json')
      expect(existsSync(mcpPath)).toBe(true)
      const config = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(config.mcpServers.gmail.command).toBe('node')
      expect(config.mcpServers.gmail.args).toEqual(['./gmail-mcp.js'])
      expect(config.mcpServers.gmail.env).toEqual({ GMAIL_TOKEN: 'x' })
      // The provenance marker ties the entry to the installing skill, so
      // only that skill's uninstall may remove it.
      expect(config.mcpServers.gmail._vynelProvenance.itemId).toBe('email-drafter')
    })
  })

  it('does NOT write an MCP config file when requiredMcpServers is empty', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await installSkillOnDisk({
        skillDefinition: makeDefinition({ requiredMcpServers: [] }),
        scope: 'workspace',
        workspacePath,
        resolvedSettings: {},
      })
      expect(existsSync(join(workspacePath, '.mcp.json'))).toBe(false)
    })
  })
})
