// SYNC full-shape read of a scope's Claude MCP config — the MCP view's
// source (the entries sibling `list-mcp-server-entries-for-scope.ts` stays
// the marketplace annotator's cheaper read). Same lenient posture: a missing
// or malformed file answers "no servers"; the WRITER is where malformed JSON
// hard-fails.
//
// Discrimination mirrors Claude Code's own reading of an entry: the `type`
// key picks the shape; anything without a valid `type` — including the
// pre-fix writer's legacy `{command, transport}` entries — executes as stdio,
// so it reads as stdio here. Header values ride back VERBATIM (backend
// round-trip honesty); every surface that leaves the backend must mask them
// to names + presence (the routes' serializer does).

import { readFileSync } from 'node:fs'
import type { SkillScope } from '../repositories/index.js'
import { resolveMcpConfigPath } from '../internal/resolve-mcp-config-path.js'
import { readMcpServerProvenanceItemId } from '../internal/mcp-server-provenance.js'

export type ConfiguredMcpServer =
  | {
      serverName: string
      transport: 'stdio'
      command: string
      args: string[]
      /** Values are secrets — never log, never list unmasked. */
      environment: Record<string, string>
      /** The catalog itemId that installed the entry; null = hand-added. */
      provenanceItemId: string | null
    }
  | {
      serverName: string
      transport: 'http' | 'sse'
      url: string
      /** Values are secrets — never log, never list unmasked. */
      headers: Record<string, string>
      /** The catalog itemId that installed the entry; null = hand-added. */
      provenanceItemId: string | null
    }

export function listMcpServersForScope(
  scope: SkillScope,
  workspacePath?: string,
): ConfiguredMcpServer[] {
  let raw: string
  try {
    raw = readFileSync(resolveMcpConfigPath(scope, workspacePath), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return []

  const servers: ConfiguredMcpServer[] = []
  for (const [serverName, entry] of Object.entries(parsed.mcpServers)) {
    if (!isRecord(entry)) continue
    const provenanceItemId = readMcpServerProvenanceItemId(entry)
    if (entry.type === 'http' || entry.type === 'sse') {
      servers.push({
        serverName,
        transport: entry.type,
        url: asString(entry.url),
        headers: asStringRecord(entry.headers),
        provenanceItemId,
      })
      continue
    }
    servers.push({
      serverName,
      transport: 'stdio',
      command: asString(entry.command),
      args: asStringArray(entry.args),
      environment: asStringRecord(entry.env),
      provenanceItemId,
    })
  }
  return servers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  if (!isRecord(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return record
}
