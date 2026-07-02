// `listClaudeConfiguredMcpServers` — reads the Claude runtime's MCP server
// configuration (read-only; installing MCP servers is the `marketplace`
// domain's job). Resilient: a missing or malformed config file yields no
// servers, never an error.
//
// Scopes covered: user (`~/.claude.json` top-level `mcpServers`) and
// workspace (`<workspace>/.mcp.json` `mcpServers`).
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  ListMcpServersInput,
  McpServerConfig,
  McpServerScope,
  McpServerTransport,
} from '../../shared/mcp-server-config.js'

export async function listClaudeConfiguredMcpServers(
  input: ListMcpServersInput,
): Promise<McpServerConfig[]> {
  const servers: McpServerConfig[] = []

  servers.push(...(await readMcpServers(path.join(os.homedir(), '.claude.json'), 'user')))

  if (input.workspacePath !== undefined) {
    servers.push(
      ...(await readMcpServers(path.join(input.workspacePath, '.mcp.json'), 'workspace')),
    )
  }

  return servers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readMcpServers(
  configPath: string,
  scope: McpServerScope,
): Promise<McpServerConfig[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'))
  } catch {
    return [] // file absent or not valid JSON
  }
  if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) {
    return []
  }

  const servers: McpServerConfig[] = []
  for (const [serverName, rawConfig] of Object.entries(parsed['mcpServers'])) {
    if (!isRecord(rawConfig)) {
      continue
    }
    const transport = resolveTransport(rawConfig['type'])
    servers.push({
      providerId: 'claude',
      scope,
      serverName,
      transport,
      commandOrUrl:
        transport === 'stdio' ? asString(rawConfig['command']) : asString(rawConfig['url']),
      args: asStringArray(rawConfig['args']),
      environment: asStringRecord(rawConfig['env']),
      // `.mcp.json` / `~/.claude.json` carry no per-server enabled flag in the
      // base shape; a configured server is treated as enabled (settings-level
      // enable/disable nuance is deferred — no Phase 1 consumer needs it).
      isEnabled: true,
    })
  }
  return servers
}

function resolveTransport(rawType: unknown): McpServerTransport {
  return rawType === 'sse' || rawType === 'http' ? rawType : 'stdio'
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      record[key] = entry
    }
  }
  return record
}
