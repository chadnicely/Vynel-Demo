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
    const isRemote = transport !== 'stdio'
    servers.push({
      providerId: 'claude',
      scope,
      serverName,
      transport,
      commandOrUrl: isRemote ? asString(rawConfig['url']) : asString(rawConfig['command']),
      // Round-trip honesty per shape: stdio carries args/env, remote carries
      // headers — never both (a remote entry has no process to spawn).
      args: isRemote ? [] : asStringArray(rawConfig['args']),
      environment: isRemote ? {} : asStringRecord(rawConfig['env']),
      headers: isRemote ? asStringRecord(rawConfig['headers']) : {},
      // `.mcp.json` / `~/.claude.json` carry no per-server enabled flag in the
      // base shape; a configured server is treated as enabled (settings-level
      // enable/disable nuance is deferred — no Phase 1 consumer needs it).
      isEnabled: true,
    })
  }
  return servers
}

// Discriminates on Claude Code's `type` key. Anything else — including the
// pre-fix writer's legacy `{command, transport}` entries, which carry no
// `type` — reads as stdio: that IS how Claude Code executes such an entry,
// so the honest read matches the runtime behavior.
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
