// Integration tests for `updateMcpServersForScope`. Real filesystem
// under `os.tmpdir()`. Split from `install-skill-on-disk.test.ts`
// per structure-standard.md "File size cap" (code-reviewer C1).

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillRequiredMcpServerStdio } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { updateMcpServersForScope } from './update-mcp-servers-for-scope.js'

async function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-mcp-update-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('updateMcpServersForScope', () => {
  it('preserves other keys in an existing config file', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      await writeFile(
        mcpPath,
        JSON.stringify({
          theme: 'dark',
          customKey: { nested: 'preserved' },
          mcpServers: { existing: { command: 'noop', args: [], env: {}, transport: 'stdio' } },
        }),
        'utf8',
      )

      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: {
              serverName: 'new',
              transport: 'stdio',
              commandOrUrl: 'cmd',
              args: [],
              environment: {},
            },
          },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.theme).toBe('dark')
      expect(after.customKey).toEqual({ nested: 'preserved' })
      expect(after.mcpServers.existing).toBeDefined()
      expect(after.mcpServers.new).toBeDefined()
    })
  })

  it('removes named servers from mcpServers without touching others', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      await writeFile(
        mcpPath,
        JSON.stringify({
          mcpServers: {
            keep: { command: 'k', args: [], env: {} },
            remove: { command: 'r', args: [], env: {} },
          },
        }),
        'utf8',
      )

      const outcome = await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [],
        serversToRemove: [{ serverName: 'remove' }],
      })

      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.mcpServers.keep).toBeDefined()
      expect(after.mcpServers.remove).toBeUndefined()
      expect(outcome.removedServerNames).toEqual(['remove'])
    })
  })

  it('creates a fresh config when the file does not exist', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      expect(existsSync(mcpPath)).toBe(false)

      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: {
              serverName: 'fresh',
              transport: 'http',
              url: 'https://x.example.com/mcp',
            },
          },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.mcpServers.fresh).toBeDefined()
    })
  })

  // The exact entry shapes Claude Code reads (SDK McpStdioServerConfig /
  // McpHttpServerConfig / McpSSEServerConfig) — keyed by `type`, never the
  // pre-fix bogus `transport` key.
  it('writes a stdio server as {type, command, args, env}', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: {
              serverName: 'playwright',
              transport: 'stdio',
              commandOrUrl: 'npx',
              args: ['@playwright/mcp@latest'],
              environment: { HEADLESS: '1' },
            },
          },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(join(workspacePath, '.mcp.json'), 'utf8'))
      expect(after.mcpServers.playwright).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        env: { HEADLESS: '1' },
      })
    })
  })

  it('writes a remote server as {type, url, headers} with no process fields', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: {
              serverName: 'linear',
              transport: 'sse',
              url: 'https://mcp.example.com/sse',
              headers: { Authorization: 'Bearer token-123' },
            },
          },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(join(workspacePath, '.mcp.json'), 'utf8'))
      expect(after.mcpServers.linear).toEqual({
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer token-123' },
      })
    })
  })

  it('omits empty headers on a remote server instead of writing headers: {}', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          { server: { serverName: 'open', transport: 'http', url: 'https://mcp.example.com/mcp' } },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(join(workspacePath, '.mcp.json'), 'utf8'))
      expect(after.mcpServers.open).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp' })
    })
  })

  it('leaves a pre-fix legacy {command, transport} entry untouched by unrelated writes', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      const legacyEntry = { command: 'https://old.example.com', args: [], env: {}, transport: 'sse' }
      await writeFile(mcpPath, JSON.stringify({ mcpServers: { legacy: legacyEntry } }), 'utf8')

      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          { server: { serverName: 'fresh', transport: 'http', url: 'https://x.example.com/mcp' } },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.mcpServers.legacy).toEqual(legacyEntry)
      expect(after.mcpServers.fresh).toEqual({ type: 'http', url: 'https://x.example.com/mcp' })
    })
  })

  it("throws on malformed JSON to preserve the user's hand-edited keys (code-reviewer C2)", async () => {
    // Pre-C2, this case silently overwrote the file. The fix throws
    // a typed error so a malformed config is surfaced before the
    // user's `~/.claude.json` data is clobbered.
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      await writeFile(mcpPath, '{ not json', 'utf8')

      await expect(
        updateMcpServersForScope({
          scope: 'workspace',
          workspacePath,
          serversToAdd: [
            {
              server: {
                serverName: 's',
                transport: 'stdio',
                commandOrUrl: 'c',
                args: [],
                environment: {},
              },
            },
          ],
          serversToRemove: [],
        }),
      ).rejects.toThrow(/malformed JSON/i)

      // File is left untouched — caller must intervene.
      const after = await readFile(mcpPath, 'utf8')
      expect(after).toBe('{ not json')
    })
  })
})

describe('updateMcpServersForScope — provenance marker', () => {
  const stdioServer = (serverName: string): SkillRequiredMcpServerStdio => ({
    serverName,
    transport: 'stdio',
    commandOrUrl: 'cmd',
    args: [],
    environment: {},
  })

  it('stamps _vynelProvenance on a provenance-carrying addition and omits it otherwise', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: stdioServer('managed'),
            provenance: { itemId: 'playwright-mcp', installedAt: '2026-08-09T00:00:00.000Z' },
          },
          { server: stdioServer('hand-shaped') },
        ],
        serversToRemove: [],
      })

      const after = JSON.parse(await readFile(join(workspacePath, '.mcp.json'), 'utf8'))
      expect(after.mcpServers.managed._vynelProvenance).toEqual({
        itemId: 'playwright-mcp',
        installedAt: '2026-08-09T00:00:00.000Z',
      })
      expect(after.mcpServers['hand-shaped']._vynelProvenance).toBeUndefined()
    })
  })

  it('refuses a provenance-carrying addition over an unmarked or other-marked entry', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      const handMade = { type: 'stdio', command: 'mine', args: [], env: {} }
      const otherItems = {
        type: 'stdio',
        command: 'other',
        args: [],
        env: {},
        _vynelProvenance: { itemId: 'other-item', installedAt: '2026-08-01T00:00:00.000Z' },
      }
      await writeFile(
        mcpPath,
        JSON.stringify({ mcpServers: { 'hand-made': handMade, 'other-owned': otherItems } }),
        'utf8',
      )

      const outcome = await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: stdioServer('hand-made'),
            provenance: { itemId: 'catalog-item', installedAt: '2026-08-09T00:00:00.000Z' },
          },
          {
            server: stdioServer('other-owned'),
            provenance: { itemId: 'catalog-item', installedAt: '2026-08-09T00:00:00.000Z' },
          },
        ],
        serversToRemove: [],
      })

      expect(outcome.refusedAdditionServerNames).toEqual(['hand-made', 'other-owned'])
      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.mcpServers['hand-made']).toEqual(handMade)
      expect(after.mcpServers['other-owned']).toEqual(otherItems)
    })
  })

  it('overwrites its OWN entry on a same-item re-add (idempotent repair)', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const provenance = { itemId: 'catalog-item', installedAt: '2026-08-09T00:00:00.000Z' }
      await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [{ server: stdioServer('repairable'), provenance }],
        serversToRemove: [],
      })
      const outcome = await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: { ...stdioServer('repairable'), commandOrUrl: 'cmd-v2' },
            provenance: { ...provenance, installedAt: '2026-08-10T00:00:00.000Z' },
          },
        ],
        serversToRemove: [],
      })

      expect(outcome.refusedAdditionServerNames).toEqual([])
      const after = JSON.parse(await readFile(join(workspacePath, '.mcp.json'), 'utf8'))
      expect(after.mcpServers.repairable.command).toBe('cmd-v2')
    })
  })

  it('a fully-refused update leaves the config file bytes untouched', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      // Hand-formatted on purpose — a rewrite would normalize it.
      const handFormatted = '{\n    "mcpServers": {"hand-made":{"command":"mine"}}\n}\n'
      await writeFile(mcpPath, handFormatted, 'utf8')

      const outcome = await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [
          {
            server: stdioServer('hand-made'),
            provenance: { itemId: 'catalog-item', installedAt: '2026-08-09T00:00:00.000Z' },
          },
        ],
        serversToRemove: [{ serverName: 'hand-made', onlyIfProvenanceItemId: 'catalog-item' }],
      })

      expect(outcome.refusedAdditionServerNames).toEqual(['hand-made'])
      expect(outcome.refusedRemovalServerNames).toEqual(['hand-made'])
      expect(await readFile(mcpPath, 'utf8')).toBe(handFormatted)
    })
  })

  it('marker-required removal deletes a matching entry and refuses unmarked/other-marked ones', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const mcpPath = join(workspacePath, '.mcp.json')
      await mkdir(workspacePath, { recursive: true })
      await writeFile(
        mcpPath,
        JSON.stringify({
          mcpServers: {
            mine: {
              type: 'stdio',
              command: 'c',
              args: [],
              env: {},
              _vynelProvenance: { itemId: 'catalog-item', installedAt: '2026-08-09T00:00:00.000Z' },
            },
            'hand-made': { type: 'stdio', command: 'mine', args: [], env: {} },
            'other-owned': {
              type: 'stdio',
              command: 'o',
              args: [],
              env: {},
              _vynelProvenance: { itemId: 'other-item', installedAt: '2026-08-01T00:00:00.000Z' },
            },
          },
        }),
        'utf8',
      )

      const outcome = await updateMcpServersForScope({
        scope: 'workspace',
        workspacePath,
        serversToAdd: [],
        serversToRemove: [
          { serverName: 'mine', onlyIfProvenanceItemId: 'catalog-item' },
          { serverName: 'hand-made', onlyIfProvenanceItemId: 'catalog-item' },
          { serverName: 'other-owned', onlyIfProvenanceItemId: 'catalog-item' },
          { serverName: 'absent', onlyIfProvenanceItemId: 'catalog-item' },
        ],
      })

      expect(outcome.removedServerNames).toEqual(['mine'])
      expect(outcome.refusedRemovalServerNames).toEqual(['hand-made', 'other-owned'])
      const after = JSON.parse(await readFile(mcpPath, 'utf8'))
      expect(after.mcpServers.mine).toBeUndefined()
      expect(after.mcpServers['hand-made']).toBeDefined()
      expect(after.mcpServers['other-owned']).toBeDefined()
    })
  })
})
