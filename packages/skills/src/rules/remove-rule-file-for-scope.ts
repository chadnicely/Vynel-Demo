// Removes one marketplace-installed rule from a scope's `.claude/rules/`
// folder — the `rule` kind's whole uninstall. The provenance marker is
// verified BEFORE deleting: an unmarked file with the same name is the
// user's own and is refused (ConflictError), never destroyed by a
// colliding catalog id. A missing file is a silent no-op.

import { readFile, rm } from 'node:fs/promises'
import { ConflictError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { parseRuleFileMarker } from './rule-file-marker.js'
import { resolveRuleFilePath } from './resolve-rules-root.js'

export type RemoveRuleFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  ruleId: string
}

export async function removeRuleFileForScope(input: RemoveRuleFileForScopeInput): Promise<void> {
  const filePath = resolveRuleFilePath(input.scope, input.ruleId, input.workspacePath)

  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (parseRuleFileMarker(content) === null) {
    throw new ConflictError(
      `The rule file '${input.ruleId}.md' was not installed by the marketplace — ` +
        'it is yours to remove by hand if you want it gone.',
    )
  }
  await rm(filePath, { force: true })
}
