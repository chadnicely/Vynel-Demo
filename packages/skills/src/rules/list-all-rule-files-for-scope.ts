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
import { parseRuleFileMarker, stripRuleFileMarker } from './rule-file-marker.js'
import { isSafeRuleId, resolveRulesRoot } from './resolve-rules-root.js'

export type RuleFileForScope = {
  /** The file name without `.md` — the row's stable id within the scope. */
  ruleId: string
  fileName: string
  /** First markdown heading, or the file name when the file has none. */
  title: string
  /** Full markdown content (rule files are small) — powers the view dialog. */
  content: string
  /** `content` without the marketplace marker line — what the editor edits. */
  body: string
  /** Non-null when the file carries a matching marketplace provenance marker
   *  (`rule-file-marker.ts` discipline: marker id must equal the file name). */
  marketplace: { ruleId: string; version: string } | null
}

/** The scope's rule FILE NAMES — the one predicate for "what is a rule here",
 *  shared by the list and the count so the menu's number and the rows behind
 *  it can never disagree about membership. A `.md` whose name the writers
 *  could not address (`isSafeRuleId`) is left out: a row the edit and delete
 *  doors cannot reach would only be a dead end in the view. */
function listRuleFileNamesForScope(scope: SkillScope, workspacePath?: string): string[] {
  const rulesRoot = resolveRulesRoot(scope, workspacePath)
  try {
    return readdirSync(rulesRoot)
      .filter((fileName) => fileName.endsWith('.md'))
      .filter((fileName) => isSafeRuleId(fileName.slice(0, -'.md'.length)))
      .sort()
  } catch {
    return []
  }
}

/**
 * How many rules this scope has — the menu badge's read.
 *
 * Names only: the count used to come from `listAllRuleFilesForScope().length`,
 * which read every file's full body (~11 KB across five files on a dev box),
 * parsed each for a marker and a title, and threw all of it away to return an
 * integer — on a path the menu polls per scope and re-runs after every
 * mutation.
 *
 * Membership stays shared (`listRuleFileNamesForScope`), so the count and the
 * list agree. One deliberate hair's-breadth difference: the list SKIPS a file
 * it cannot read, this counts it. A locked or unreadable `.md` is still a rule
 * sitting in the folder, and refusing to open five files just to notice one is
 * missing is the exact cost this exists to avoid.
 */
export function countAllRuleFilesForScope(scope: SkillScope, workspacePath?: string): number {
  return listRuleFileNamesForScope(scope, workspacePath).length
}

export function listAllRuleFilesForScope(
  scope: SkillScope,
  workspacePath?: string,
): RuleFileForScope[] {
  const rulesRoot = resolveRulesRoot(scope, workspacePath)

  const rules: RuleFileForScope[] = []
  for (const fileName of listRuleFileNamesForScope(scope, workspacePath)) {
    let content: string
    try {
      content = readFileSync(path.join(rulesRoot, fileName), 'utf8')
    } catch {
      continue
    }
    rules.push(toRuleFile(fileName, content))
  }
  return rules
}

/** One rule by id — the write door's read-back. `null` = no such file (or one
 *  the writers could not address). */
export function readRuleFileForScope(
  scope: SkillScope,
  ruleId: string,
  workspacePath?: string,
): RuleFileForScope | null {
  if (!isSafeRuleId(ruleId)) return null
  const fileName = `${ruleId}.md`
  try {
    const content = readFileSync(path.join(resolveRulesRoot(scope, workspacePath), fileName), 'utf8')
    return toRuleFile(fileName, content)
  } catch {
    return null
  }
}

function toRuleFile(fileName: string, content: string): RuleFileForScope {
  const ruleId = fileName.slice(0, -'.md'.length)
  const marker = parseRuleFileMarker(content)
  return {
    ruleId,
    fileName,
    title: extractTitle(content) ?? ruleId,
    content,
    body: stripRuleFileMarker(content),
    // Same discipline as the installed-reader: a marker naming a DIFFERENT
    // rule is a user-renamed copy — it is theirs, not the marketplace's.
    marketplace:
      marker !== null && marker.ruleId === ruleId
        ? { ruleId: marker.ruleId, version: marker.version }
        : null,
  }
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
