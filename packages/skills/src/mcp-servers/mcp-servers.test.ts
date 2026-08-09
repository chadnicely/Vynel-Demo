// The standalone MCP-server config ops over a real isolated home dir +
// workspace dir: install/list/remove round-trip per scope, hand-edited
// key preservation, the lenient-read postures, and the provenance guard
// in both directions (install never clobbers a foreign entry; a
// marker-required remove never deletes one).

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConflictError } from '@vynel/errors'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { installMcpServerForScope } from './install-mcp-server-for-scope.js'
import { removeMcpServerForScope } from './remove-mcp-server-for-scope.js'
import { listMcpServerEntriesForScope } from './list-mcp-server-entries-for-scope.js'

const PLAYWRIGHT_SERVER = {
  serverName: 'playwright',
  transport: 'stdio' as const,
  commandOrUrl: 'npx',
  args: ['@playwright/mcp@latest'],
  environment: {},
}

const PLAYWRIGHT_PROVENANCE = {
  itemId: 'playwright-mcp',
  installedAt: '2026-08-09T00:00:00.000Z',
}

function listedNames(scope: 'user' | 'workspace', workspacePath?: string): string[] {
  return listMcpServerEntriesForScope(scope, workspacePath).map((entry) => entry.serverName)
}

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-servers-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-servers-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('mcp-servers config ops', () => {
  it('user scope: install → listed in ~/.claude.json → remove → gone', async () => {
    await withIsolatedDirs(async (homeDir) => {
      expect(listMcpServerEntriesForScope('user')).toEqual([])

      await installMcpServerForScope({
        scope: 'user',
        server: PLAYWRIGHT_SERVER,
        provenance: PLAYWRIGHT_PROVENANCE,
      })
      expect(listMcpServerEntriesForScope('user')).toEqual([
        { serverName: 'playwright', provenanceItemId: 'playwright-mcp' },
      ])

      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        mcpServers: Record<string, { command: string; args: string[] }>
      }
      expect(config.mcpServers.playwright).toMatchObject({
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        _vynelProvenance: PLAYWRIGHT_PROVENANCE,
      })

      await removeMcpServerForScope({
        scope: 'user',
        serverName: 'playwright',
        onlyIfProvenanceItemId: 'playwright-mcp',
      })
      expect(listMcpServerEntriesForScope('user')).toEqual([])
    })
  })

  it('workspace scope: entry lands in <workspace>/.mcp.json, not the home config', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      await installMcpServerForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        server: PLAYWRIGHT_SERVER,
      })
      expect(listedNames('workspace', workspaceDir)).toEqual(['playwright'])
      expect(listedNames('user')).toEqual([])
    })
  })

  it("preserves the user's hand-edited config keys around the write", async () => {
    await withIsolatedDirs(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ theme: 'dark', mcpServers: { existing: { command: 'x' } } }),
        'utf8',
      )
      await installMcpServerForScope({ scope: 'user', server: PLAYWRIGHT_SERVER })

      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        theme: string
        mcpServers: Record<string, unknown>
      }
      expect(config.theme).toBe('dark')
      expect(Object.keys(config.mcpServers).sort()).toEqual(['existing', 'playwright'])
    })
  })

  it('lenient read: malformed config answers empty instead of throwing', async () => {
    await withIsolatedDirs(async (homeDir) => {
      writeFileSync(join(homeDir, '.claude.json'), '{not json', 'utf8')
      expect(listMcpServerEntriesForScope('user')).toEqual([])
    })
  })

  it('a hand-added entry lists with provenanceItemId null', async () => {
    await withIsolatedDirs(async () => {
      await installMcpServerForScope({ scope: 'user', server: PLAYWRIGHT_SERVER })
      expect(listMcpServerEntriesForScope('user')).toEqual([
        { serverName: 'playwright', provenanceItemId: null },
      ])
    })
  })

  it('provenance install refuses to overwrite a hand-added entry with the same name', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installMcpServerForScope({ scope: 'user', server: PLAYWRIGHT_SERVER })
      const before = readFileSync(join(homeDir, '.claude.json'), 'utf8')

      await expect(
        installMcpServerForScope({
          scope: 'user',
          server: { ...PLAYWRIGHT_SERVER, commandOrUrl: 'catalog-cmd' },
          provenance: PLAYWRIGHT_PROVENANCE,
        }),
      ).rejects.toThrow(ConflictError)
      expect(readFileSync(join(homeDir, '.claude.json'), 'utf8')).toBe(before)
    })
  })

  it('provenance install overwrites its OWN prior entry (idempotent repair)', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installMcpServerForScope({
        scope: 'user',
        server: PLAYWRIGHT_SERVER,
        provenance: PLAYWRIGHT_PROVENANCE,
      })
      await installMcpServerForScope({
        scope: 'user',
        server: { ...PLAYWRIGHT_SERVER, commandOrUrl: 'npx-v2' },
        provenance: { ...PLAYWRIGHT_PROVENANCE, installedAt: '2026-08-10T00:00:00.000Z' },
      })

      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        mcpServers: Record<string, { command: string }>
      }
      expect(config.mcpServers.playwright!.command).toBe('npx-v2')
    })
  })

  it('marker-required remove refuses a hand-added entry and leaves it in place', async () => {
    await withIsolatedDirs(async () => {
      await installMcpServerForScope({ scope: 'user', server: PLAYWRIGHT_SERVER })

      await expect(
        removeMcpServerForScope({
          scope: 'user',
          serverName: 'playwright',
          onlyIfProvenanceItemId: 'playwright-mcp',
        }),
      ).rejects.toThrow(ConflictError)
      expect(listedNames('user')).toEqual(['playwright'])
    })
  })

  it('marker-less remove still removes any entry (the user-driven routes path)', async () => {
    await withIsolatedDirs(async () => {
      await installMcpServerForScope({
        scope: 'user',
        server: PLAYWRIGHT_SERVER,
        provenance: PLAYWRIGHT_PROVENANCE,
      })
      await removeMcpServerForScope({ scope: 'user', serverName: 'playwright' })
      expect(listMcpServerEntriesForScope('user')).toEqual([])
    })
  })
})

// Workspace `.mcp.json` servers stay untrusted to Claude Code until the
// project approval lands in ~/.claude.json (smoked live 2026-08-09:
// login refuses with "awaiting approval") — every consent-backed
// workspace write records it, and removal revokes it.
describe('workspace installs record the project approval', () => {
  it('install approves in ~/.claude.json projects; uninstall revokes', async () => {
    await withIsolatedDirs(async (homeDir, workspaceDir) => {
      await installMcpServerForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        server: PLAYWRIGHT_SERVER,
        provenance: PLAYWRIGHT_PROVENANCE,
      })
      let config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        projects: Record<string, { enabledMcpjsonServers: string[] }>
      }
      expect(config.projects[workspaceDir]!.enabledMcpjsonServers).toEqual(['playwright'])

      await removeMcpServerForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        serverName: 'playwright',
        onlyIfProvenanceItemId: 'playwright-mcp',
      })
      config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        projects: Record<string, { enabledMcpjsonServers: string[] }>
      }
      expect(config.projects[workspaceDir]!.enabledMcpjsonServers).toEqual([])
    })
  })

  it('user-scope installs never touch the projects record', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installMcpServerForScope({
        scope: 'user',
        server: PLAYWRIGHT_SERVER,
        provenance: PLAYWRIGHT_PROVENANCE,
      })
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        projects?: unknown
      }
      expect(config.projects).toBeUndefined()
    })
  })
})
