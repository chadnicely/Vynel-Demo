// Resolves the on-disk `.claude/rules/` folder for a scope — the native
// location Claude Code loads rule files from (user rules apply to every
// project; workspace rules to that project). Companion to
// `../internal/resolve-mcp-config-path.ts`; home-dir lookup routes through
// the shared `resolve-host-home-dir` seam so tests isolate to a tmpdir.

import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'

// Catalog ids are hub-validated kebab-case, but the id becomes a filename —
// defense-in-depth against a path-traversal id ever reaching the fs ops.
const SAFE_RULE_ID = /^[a-z0-9][a-z0-9-]*$/

export function assertSafeRuleId(ruleId: string): void {
  if (!SAFE_RULE_ID.test(ruleId)) {
    throw new Error(`Rule id '${ruleId}' is not a safe file name`)
  }
}

export function resolveRulesRoot(scope: SkillScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'rules')
  }
  if (!workspacePath) {
    throw new Error('resolveRulesRoot: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.claude', 'rules')
}

export function resolveRuleFilePath(
  scope: SkillScope,
  ruleId: string,
  workspacePath?: string,
): string {
  assertSafeRuleId(ruleId)
  return path.join(resolveRulesRoot(scope, workspacePath), `${ruleId}.md`)
}
