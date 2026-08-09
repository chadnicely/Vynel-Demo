// The provenance marker a Vynel-managed `mcpServers` entry carries — the
// mcp twin of the rule-file marker (marketplace-kinds.md: unmarked files
// never annotate, never get overwritten, never get deleted). Probed
// 2026-08-09: Claude Code tolerates the extra key, never displays it, and
// preserves it across its own config rewrites — so the marker can live IN
// the entry and config stays the single truth.
//
// `itemId` is the catalog item that owns the entry: the mcp item's id for
// standalone installs, the skill's id for required-server installs. A
// hand-added entry carries no marker, which is exactly what protects it.

export const MCP_SERVER_PROVENANCE_KEY = '_vynelProvenance'

export type McpServerProvenance = {
  itemId: string
  installedAt: string
}

export function readMcpServerProvenanceItemId(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null
  const marker = (entry as Record<string, unknown>)[MCP_SERVER_PROVENANCE_KEY]
  if (typeof marker !== 'object' || marker === null) return null
  const itemId = (marker as Record<string, unknown>).itemId
  return typeof itemId === 'string' && itemId.length > 0 ? itemId : null
}
