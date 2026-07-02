// Tests for `listClaudeConfiguredMcpServers` — fixture .mcp.json + a
// missing-file resilience case.
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
      },
    }),
  )
})

afterAll(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('listClaudeConfiguredMcpServers', () => {
  it('reads workspace-scope MCP servers from .mcp.json', async () => {
    const servers = await listClaudeConfiguredMcpServers({ workspacePath })
    expect(servers).toContainEqual({
      providerId: 'claude',
      scope: 'workspace',
      serverName: 'filesystem',
      transport: 'stdio',
      commandOrUrl: 'npx',
      args: ['-y', 'mcp-fs'],
      environment: { ROOT: '/tmp' },
      isEnabled: true,
    })
  })

  it('returns an array without throwing when there is no .mcp.json', async () => {
    const servers = await listClaudeConfiguredMcpServers({
      workspacePath: join(tmpdir(), `vynel-nomcp-${randomUUID()}`),
    })
    expect(Array.isArray(servers)).toBe(true)
  })
})
