// Resolves the on-disk `.claude/rules/` folder for a scope — the native
// location Claude Code loads rule files from (user rules apply to every
// project; workspace rules to that project). Companion to
// `../internal/resolve-mcp-config-path.ts`; home-dir lookup routes through
// the shared `resolve-host-home-dir` seam so tests isolate to a tmpdir.

import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'
import { isSafeFileStem, MAX_FILE_STEM_LENGTH } from '../internal/safe-file-stem.js'

export const MAX_RULE_ID_LENGTH = MAX_FILE_STEM_LENGTH

/** A rule id is one file stem in the rules folder — the shared predicate
 *  keeps the folder reader and every writer addressing the same files. */
export function isSafeRuleId(ruleId: string): boolean {
  return isSafeFileStem(ruleId)
}

export function assertSafeRuleId(ruleId: string): void {
  if (!isSafeRuleId(ruleId)) {
    throw new ValidationError(
      `Rule name '${ruleId}' is not a safe file name — use letters, digits and dashes ` +
        '(no slashes, no leading dot).',
    )
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
