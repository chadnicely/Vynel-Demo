// Resolves the on-disk `.claude/commands/` folder for a scope — the native
// location Claude Code loads slash-command files from (user commands apply
// everywhere; workspace commands to that project). Companion to
// `../rules/resolve-rules-root.ts`; home-dir lookup routes through the shared
// `resolve-host-home-dir` seam so tests isolate to a tmpdir.

import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'

export function resolveCommandsRoot(scope: SkillScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'commands')
  }
  if (!workspacePath) {
    throw new Error('resolveCommandsRoot: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.claude', 'commands')
}
