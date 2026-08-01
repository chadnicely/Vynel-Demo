// The standalone MCP-server config ops over a real isolated home dir +
// workspace dir: install/list/remove round-trip per scope, hand-edited
// key preservation, and the lenient-read postures.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { installMcpServerForScope } from './install-mcp-server-for-scope.js'
import { removeMcpServerForScope } from './remove-mcp-server-for-scope.js'
import { listMcpServerNamesForScope } from './list-mcp-server-names-for-scope.js'

const PLAYWRIGHT_SERVER = {
  serverName: 'playwright',
  transport: 'stdio' as const,
  commandOrUrl: 'npx',
  args: ['@playwright/mcp@latest'],
  environment: {},
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
      expect(listMcpServerNamesForScope('user')).toEqual([])

      await installMcpServerForScope({ scope: 'user', server: PLAYWRIGHT_SERVER })
      expect(listMcpServerNamesForScope('user')).toEqual(['playwright'])

      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
        mcpServers: Record<string, { command: string; args: string[] }>
      }
      expect(config.mcpServers.playwright).toMatchObject({
        command: 'npx',
        args: ['@playwright/mcp@latest'],
      })

      await removeMcpServerForScope({ scope: 'user', serverName: 'playwright' })
      expect(listMcpServerNamesForScope('user')).toEqual([])
    })
  })

  it('workspace scope: entry lands in <workspace>/.mcp.json, not the home config', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      await installMcpServerForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        server: PLAYWRIGHT_SERVER,
      })
      expect(listMcpServerNamesForScope('workspace', workspaceDir)).toEqual(['playwright'])
      expect(listMcpServerNamesForScope('user')).toEqual([])
    })
  })

  it('preserves the user\'s hand-edited config keys around the write', async () => {
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
      expect(listMcpServerNamesForScope('user')).toEqual([])
    })
  })
})
