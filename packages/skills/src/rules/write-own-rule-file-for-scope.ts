// Writes one of the user's OWN rule files into a scope's `.claude/rules/`
// folder — the create AND edit door for the Rules view and the `write_rule`
// tool (config-is-truth: the file is the record). Twin of the marketplace's
// `install-rule-file-for-scope.ts`, with the opposite posture: that writer
// refuses to touch an unmarked file; this one writes whatever the user
// asked for and never stamps a marker. Saving over a marketplace-installed
// rule forks it — the marker is stripped so the card stops reading
// "Installed" and a re-install can no longer clobber the user's edits.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { stripRuleFileMarker } from './rule-file-marker.js'
import { resolveRuleFilePath } from './resolve-rules-root.js'

export const MAX_RULE_FILE_LENGTH = 50_000

export type WriteOwnRuleFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  ruleId: string
  content: string
}

export async function writeOwnRuleFileForScope(
  input: WriteOwnRuleFileForScopeInput,
): Promise<{ filePath: string }> {
  const filePath = resolveRuleFilePath(input.scope, input.ruleId, input.workspacePath)
  const content = normalizeRuleContent(input.content)

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { filePath }
}

// One trailing newline, marker gone: a marker line in user-supplied content
// would make the file annotate as a marketplace install it never was.
function normalizeRuleContent(raw: string): string {
  const content = stripRuleFileMarker(raw).replace(/\s+$/, '')
  if (content.length === 0) {
    throw new ValidationError('A rule needs some content — write what Claude should follow.')
  }
  if (content.length > MAX_RULE_FILE_LENGTH) {
    throw new ValidationError(
      `A rule file is capped at ${MAX_RULE_FILE_LENGTH} characters — split it into two rules.`,
    )
  }
  return `${content}\n`
}
