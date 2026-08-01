// Installs one marketplace rule into a scope's `.claude/rules/` folder —
// the marketplace `rule` kind's whole install (config-is-truth, Chad
// 2026-08-02): the `<ruleId>.md` file IS the installed state; no DB row.
// The content opens with the provenance marker, and an existing UNMARKED
// file with the same name is the user's own — installing over it is
// refused (ConflictError), never a silent clobber. A marked file is
// overwritten freely (idempotent repair / version refresh).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ConflictError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { buildRuleFileContent, parseRuleFileMarker } from './rule-file-marker.js'
import { resolveRuleFilePath } from './resolve-rules-root.js'

export type InstallRuleFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  ruleId: string
  version: string
  ruleMarkdown: string
}

export async function installRuleFileForScope(input: InstallRuleFileForScopeInput): Promise<void> {
  const filePath = resolveRuleFilePath(input.scope, input.ruleId, input.workspacePath)

  let existing: string | null = null
  try {
    existing = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  // Refuse unless the existing file carries THIS rule's marker — an
  // unmarked file is hand-authored, and a marker naming a different rule
  // is a user-renamed copy of another install; both are theirs (the
  // reader applies the same marker-id === filename discipline).
  const existingMarker = existing !== null ? parseRuleFileMarker(existing) : null
  if (existing !== null && existingMarker?.ruleId !== input.ruleId) {
    throw new ConflictError(
      `A rule file named '${input.ruleId}.md' already exists and was not installed by the ` +
        'marketplace — rename or remove your file first if you want the catalog version.',
    )
  }

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, buildRuleFileContent(input.ruleId, input.version, input.ruleMarkdown), 'utf8')
}
