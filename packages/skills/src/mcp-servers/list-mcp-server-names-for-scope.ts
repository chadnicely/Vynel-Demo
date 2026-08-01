// SYNC read of the server names in a scope's Claude MCP config — the
// marketplace annotator's installed-state source for `mcp` items
// (config-is-truth: presence of the key IS installed). Sync because the
// marketplace list pipeline is sync (Phase-1); the config files are tiny.
//
// Lenient on purpose (the read half of strict-write/lenient-read): a
// missing or malformed file answers "nothing installed" so browse never
// throws on a config mid-edit — the WRITER is where malformed JSON
// hard-fails (`update-mcp-servers-for-scope.ts` refuses to clobber).

import { readFileSync } from 'node:fs'
import type { SkillScope } from '../repositories/index.js'
import { resolveMcpConfigPath } from '../internal/resolve-mcp-config-path.js'

export function listMcpServerNamesForScope(scope: SkillScope, workspacePath?: string): string[] {
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
    return Object.keys(servers)
  } catch {
    return []
  }
}
