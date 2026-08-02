// SYNC read of EVERY rule file in a scope's `.claude/rules/` folder — the
// Rules view's source. Deliberately a sibling of the marker-filtered
// `list-installed-rules-for-scope.ts`: that reader answers the marketplace
// annotator ("which files did WE install?") and must keep hiding hand-written
// rules; this one shows the user their whole folder, with the marketplace
// provenance surfaced per file instead of used as a filter. Lenient
// throughout — a missing folder or unreadable file just contributes nothing.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { parseRuleFileMarker } from './rule-file-marker.js'
import { resolveRulesRoot } from './resolve-rules-root.js'

export type RuleFileForScope = {
  /** The file name without `.md` — the row's stable id within the scope. */
  ruleId: string
  fileName: string
  /** First markdown heading, or the file name when the file has none. */
  title: string
  /** Full markdown content (rule files are small) — powers the view dialog. */
  content: string
  /** Non-null when the file carries a matching marketplace provenance marker
   *  (`rule-file-marker.ts` discipline: marker id must equal the file name). */
  marketplace: { ruleId: string; version: string } | null
}

export function listAllRuleFilesForScope(
  scope: SkillScope,
  workspacePath?: string,
): RuleFileForScope[] {
  const rulesRoot = resolveRulesRoot(scope, workspacePath)
  let entries: string[]
  try {
    entries = readdirSync(rulesRoot)
  } catch {
    return []
  }

  const rules: RuleFileForScope[] = []
  for (const fileName of entries.sort()) {
    if (!fileName.endsWith('.md')) continue
    let content: string
    try {
      content = readFileSync(path.join(rulesRoot, fileName), 'utf8')
    } catch {
      continue
    }
    const ruleId = fileName.slice(0, -'.md'.length)
    const marker = parseRuleFileMarker(content)
    rules.push({
      ruleId,
      fileName,
      title: extractTitle(content) ?? ruleId,
      content,
      // Same discipline as the installed-reader: a marker naming a DIFFERENT
      // rule is a user-renamed copy — it is theirs, not the marketplace's.
      marketplace:
        marker !== null && marker.ruleId === ruleId
          ? { ruleId: marker.ruleId, version: marker.version }
          : null,
    })
  }
  return rules
}

// First ATX heading wins. BOM + CRLF tolerant like `parseRuleFileMarker` —
// a Windows-editor re-save must not blank every title.
function extractTitle(content: string): string | null {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  for (const rawLine of withoutBom.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(rawLine.replace(/\r$/, ''))
    if (match !== null) return match[1]!
  }
  return null
}
