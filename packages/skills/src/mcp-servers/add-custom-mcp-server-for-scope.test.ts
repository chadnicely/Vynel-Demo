// The custom-add op's guardrails: collision refusal (never clobber an
// existing entry from a form), the https-only remote policy with its
// loopback exemption, and the happy paths landing the exact Claude shapes.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConflictError, ValidationError } from '@vynel/errors'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { addCustomMcpServerForScope } from './add-custom-mcp-server-for-scope.js'

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-add-home-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

function readUserConfig(homeDir: string) {
  return JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')) as {
    mcpServers: Record<string, unknown>
  }
}

describe('addCustomMcpServerForScope', () => {
  it('adds a stdio server to the user scope', async () => {
    await withIsolatedHome(async (homeDir) => {
      await addCustomMcpServerForScope({
        scope: 'user',
        server: {
          serverName: 'my-tool',
          transport: 'stdio',
          commandOrUrl: 'node',
          args: ['tool.js'],
          environment: { TOKEN: 'x' },
        },
      })
      expect(readUserConfig(homeDir).mcpServers['my-tool']).toEqual({
        type: 'stdio',
        command: 'node',
        args: ['tool.js'],
        env: { TOKEN: 'x' },
      })
    })
  })

  it('adds a remote https server with headers', async () => {
    await withIsolatedHome(async (homeDir) => {
      await addCustomMcpServerForScope({
        scope: 'user',
        server: {
          serverName: 'linear',
          transport: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      })
      expect(readUserConfig(homeDir).mcpServers.linear).toEqual({
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer secret' },
      })
    })
  })

  it('refuses a name that already exists at the scope (no silent clobber)', async () => {
    await withIsolatedHome(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { taken: { type: 'stdio', command: 'x' } } }),
        'utf8',
      )
      await expect(
        addCustomMcpServerForScope({
          scope: 'user',
          server: { serverName: 'taken', transport: 'http', url: 'https://a.example.com' },
        }),
      ).rejects.toBeInstanceOf(ConflictError)
      // The existing entry is untouched.
      expect(readUserConfig(homeDir).mcpServers.taken).toEqual({ type: 'stdio', command: 'x' })
    })
  })

  it('refuses plain-http remote URLs except loopback', async () => {
    await withIsolatedHome(async () => {
      await expect(
        addCustomMcpServerForScope({
          scope: 'user',
          server: { serverName: 'insecure', transport: 'sse', url: 'http://example.com/sse' },
        }),
      ).rejects.toBeInstanceOf(ValidationError)

      await addCustomMcpServerForScope({
        scope: 'user',
        server: { serverName: 'dev', transport: 'sse', url: 'http://localhost:3000/sse' },
      })
      await addCustomMcpServerForScope({
        scope: 'user',
        server: { serverName: 'dev2', transport: 'http', url: 'http://127.0.0.1:8080/mcp' },
      })
    })
  })

  it('refuses junk URLs and blank names', async () => {
    await withIsolatedHome(async () => {
      await expect(
        addCustomMcpServerForScope({
          scope: 'user',
          server: { serverName: 'bad-url', transport: 'http', url: 'not a url' },
        }),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        addCustomMcpServerForScope({
          scope: 'user',
          server: { serverName: '   ', transport: 'http', url: 'https://a.example.com' },
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('writes to the workspace config when workspace-scoped', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-add-ws-'))
    try {
      await withIsolatedHome(async () => {
        await addCustomMcpServerForScope({
          scope: 'workspace',
          workspacePath: workspaceDir,
          server: { serverName: 'ws-server', transport: 'http', url: 'https://b.example.com' },
        })
      })
      const config = JSON.parse(readFileSync(join(workspaceDir, '.mcp.json'), 'utf8')) as {
        mcpServers: Record<string, unknown>
      }
      expect(config.mcpServers['ws-server']).toEqual({ type: 'http', url: 'https://b.example.com' })
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})
