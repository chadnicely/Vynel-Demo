// Deletes one rule file from a scope's `.claude/rules/` folder on the USER's
// explicit say-so — the Rules view's delete and the `delete_rule` tool.
// Unlike the marketplace's `remove-rule-file-for-scope.ts` (which refuses an
// unmarked file, because a catalog id must never destroy the user's work),
// this door removes the named file whether it is the user's own or a
// marketplace install: the person asking IS the owner, and for a marked
// file the outcome equals an uninstall. A missing file is a 404, not a
// silent no-op — the caller named something that isn't there.

import { rm, stat } from 'node:fs/promises'
import { NotFoundError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { resolveRuleFilePath } from './resolve-rules-root.js'

export type DeleteOwnRuleFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  ruleId: string
}

export async function deleteOwnRuleFileForScope(
  input: DeleteOwnRuleFileForScopeInput,
): Promise<void> {
  const filePath = resolveRuleFilePath(input.scope, input.ruleId, input.workspacePath)
  try {
    await stat(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('rule', input.ruleId)
    }
    throw err
  }
  await rm(filePath, { force: true })
}
