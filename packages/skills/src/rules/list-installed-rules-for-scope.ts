// SYNC read of the MARKETPLACE-INSTALLED rules in a scope's
// `.claude/rules/` folder — the marketplace annotator's installed-state
// source for `rule` items. Only files carrying the provenance marker
// count: the user's hand-written rules in the same folder must never
// annotate a card as Installed. Sync because the marketplace list
// pipeline is sync; rule folders are tiny. Lenient throughout — a
// missing folder or unreadable file answers "nothing installed".

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { parseRuleFileMarker } from './rule-file-marker.js'
import { resolveRulesRoot } from './resolve-rules-root.js'

export type InstalledRuleFile = {
  ruleId: string
  version: string
}

export function listInstalledRulesForScope(
  scope: SkillScope,
  workspacePath?: string,
): InstalledRuleFile[] {
  let entries: string[]
  try {
    entries = readdirSync(resolveRulesRoot(scope, workspacePath))
  } catch {
    return []
  }
  const installed: InstalledRuleFile[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    let content: string
    try {
      content = readFileSync(path.join(resolveRulesRoot(scope, workspacePath), entry), 'utf8')
    } catch {
      continue
    }
    const marker = parseRuleFileMarker(content)
    // The marker's ruleId must match the file name — a hand-renamed copy
    // is no longer the installed artifact and must not annotate.
    if (marker !== null && `${marker.ruleId}.md` === entry) {
      installed.push({ ruleId: marker.ruleId, version: marker.version })
    }
  }
  return installed
}
