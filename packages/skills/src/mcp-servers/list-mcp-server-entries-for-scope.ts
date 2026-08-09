// SYNC read of the entries in a scope's Claude MCP config — the
// marketplace annotator's installed-state source for `mcp` items
// (config-is-truth: presence of the key IS installed, and the provenance
// marker says WHOSE install it is — an unmarked entry is the user's
// hand-made server and must never annotate a catalog item). Sync because
// the marketplace list pipeline is sync (Phase-1); the config files are
// tiny. Replaces the names-only lister when the marker landed (2026-08-09).
//
// Lenient on purpose (the read half of strict-write/lenient-read): a
// missing or malformed file answers "nothing installed" so browse never
// throws on a config mid-edit — the WRITER is where malformed JSON
// hard-fails (`update-mcp-servers-for-scope.ts` refuses to clobber).

import { readFileSync } from 'node:fs'
import type { SkillScope } from '../repositories/index.js'
import { resolveMcpConfigPath } from '../internal/resolve-mcp-config-path.js'
import { readMcpServerProvenanceItemId } from '../internal/mcp-server-provenance.js'

export type McpServerEntryView = {
  serverName: string
  /** The catalog itemId that installed the entry; null = hand-added. */
  provenanceItemId: string | null
}

export function listMcpServerEntriesForScope(
  scope: SkillScope,
  workspacePath?: string,
): McpServerEntryView[] {
  let raw: string
  try {
    raw = readFileSync(resolveMcpConfigPath(scope, workspacePath), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: unknown }
    if (typeof parsed !== 'object' || parsed === null) return []
    const servers = parsed.mcpServers
    if (typeof servers !== 'object' || servers === null) return []
    return Object.entries(servers).map(([serverName, entry]) => ({
      serverName,
      provenanceItemId: readMcpServerProvenanceItemId(entry),
    }))
  } catch {
    return []
  }
}
