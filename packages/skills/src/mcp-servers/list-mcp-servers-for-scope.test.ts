// The full-shape config read behind the MCP view: both entry shapes, both
// scopes, the legacy `{command, transport}` tolerance, and the lenient
// missing/malformed postures.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { listMcpServersForScope } from './list-mcp-servers-for-scope.js'

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-full-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-full-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('listMcpServersForScope', () => {
  it('reads both shapes from the user config, headers verbatim', async () => {
    await withIsolatedDirs(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
            linear: {
              type: 'sse',
              url: 'https://mcp.example.com/sse',
              headers: { Authorization: 'Bearer secret-1' },
            },
          },
        }),
        'utf8',
      )

      expect(listMcpServersForScope('user')).toEqual([
        {
          serverName: 'playwright',
          transport: 'stdio',
          command: 'npx',
          args: ['@playwright/mcp@latest'],
          environment: {},
          provenanceItemId: null,
        },
        {
          serverName: 'linear',
          transport: 'sse',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer secret-1' },
          provenanceItemId: null,
        },
      ])
    })
  })

  it('reads the workspace config independently of the user config', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      writeFileSync(
        join(workspaceDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { local: { command: 'node', args: ['x.js'] } } }),
        'utf8',
      )
      expect(listMcpServersForScope('workspace', workspaceDir)).toEqual([
        {
          serverName: 'local',
          transport: 'stdio',
          command: 'node',
          args: ['x.js'],
          environment: {},
          provenanceItemId: null,
        },
      ])
      expect(listMcpServersForScope('user')).toEqual([])
    })
  })

  it('reads a legacy {command, transport} entry as stdio without crashing', async () => {
    await withIsolatedDirs(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            legacy: { command: 'https://old.example.com', args: [], env: {}, transport: 'http' },
          },
        }),
        'utf8',
      )
      expect(listMcpServersForScope('user')).toEqual([
        {
          serverName: 'legacy',
          transport: 'stdio',
          command: 'https://old.example.com',
          args: [],
          environment: {},
          provenanceItemId: null,
        },
      ])
    })
  })

  it('surfaces the provenance marker itemId on a marketplace-installed entry', async () => {
    await withIsolatedDirs(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            managed: {
              type: 'http',
              url: 'https://mcp.example.com/mcp',
              _vynelProvenance: { itemId: 'linear-mcp', installedAt: '2026-08-09T00:00:00.000Z' },
            },
          },
        }),
        'utf8',
      )
      expect(listMcpServersForScope('user')).toEqual([
        {
          serverName: 'managed',
          transport: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: {},
          provenanceItemId: 'linear-mcp',
        },
      ])
    })
  })

  it('answers empty on a missing or malformed config', async () => {
    await withIsolatedDirs(async (homeDir) => {
      expect(listMcpServersForScope('user')).toEqual([])
      writeFileSync(join(homeDir, '.claude.json'), '{not json', 'utf8')
      expect(listMcpServersForScope('user')).toEqual([])
    })
  })
})
