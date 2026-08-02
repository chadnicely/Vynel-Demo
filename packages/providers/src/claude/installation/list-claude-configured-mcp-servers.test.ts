// Tests for `listClaudeConfiguredMcpServers` — fixture .mcp.json + a
// missing-file resilience case, covering both config shapes (stdio and
// remote) plus the legacy `{command, transport}` tolerance.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listClaudeConfiguredMcpServers } from './list-claude-configured-mcp-servers.js'

const workspacePath = join(tmpdir(), `vynel-mcp-test-${randomUUID()}`)

beforeAll(async () => {
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    join(workspacePath, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', 'mcp-fs'], env: { ROOT: '/tmp' } },
        linear: {
          type: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer token-123' },
        },
        // The pre-fix writer's shape: no `type`, a bogus `transport` key. It
        // must read as stdio (that is how Claude Code executes it) — never
        // crash the listing.
        legacy: { command: 'https://old.example.com', args: [], env: {}, transport: 'sse' },
      },
    }),
  )
})

afterAll(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('listClaudeConfiguredMcpServers', () => {
  it('reads workspace-scope stdio MCP servers from .mcp.json', async () => {
    const servers = await listClaudeConfiguredMcpServers({ workspacePath })
    expect(servers).toContainEqual({
      providerId: 'claude',
      scope: 'workspace',
      serverName: 'filesystem',
      transport: 'stdio',
      commandOrUrl: 'npx',
      args: ['-y', 'mcp-fs'],
      environment: { ROOT: '/tmp' },
      headers: {},
      isEnabled: true,
    })
  })

  it('reads a remote (http) server as url + headers, with no process fields', async () => {
    const servers = await listClaudeConfiguredMcpServers({ workspacePath })
    expect(servers).toContainEqual({
      providerId: 'claude',
      scope: 'workspace',
      serverName: 'linear',
      transport: 'http',
      commandOrUrl: 'https://mcp.example.com/mcp',
      args: [],
      environment: {},
      headers: { Authorization: 'Bearer token-123' },
      isEnabled: true,
    })
  })

  it('treats a legacy {command, transport} entry as stdio', async () => {
    const servers = await listClaudeConfiguredMcpServers({ workspacePath })
    const legacy = servers.find((server) => server.serverName === 'legacy')
    expect(legacy).toMatchObject({ transport: 'stdio', commandOrUrl: 'https://old.example.com' })
  })

  it('returns an array without throwing when there is no .mcp.json', async () => {
    const servers = await listClaudeConfiguredMcpServers({
      workspacePath: join(tmpdir(), `vynel-nomcp-${randomUUID()}`),
    })
    expect(Array.isArray(servers)).toBe(true)
  })
})
