// Resolves the on-disk MCP config path for a skill scope.
//
// **Host-OS state read — carved out.** Companion to
// `resolve-skills-root.ts` (both consume the shared
// `resolve-host-home-dir.ts` seam). User scope reads from
// `~/.claude.json`; workspace scope reads from
// `<workspacePath>/.mcp.json`. The user's hand-edited
// `~/.claude.json` keys are preserved by the writer (it touches
// only the `mcpServers` field); this helper only resolves the
// path. Home-dir lookup routes through `resolveHostHomeDir()` so
// tests isolate to a per-test tmpdir.

import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from './resolve-host-home-dir.js'

export function resolveMcpConfigPath(scope: SkillScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude.json')
  }
  if (!workspacePath) {
    throw new Error('resolveMcpConfigPath: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.mcp.json')
}
