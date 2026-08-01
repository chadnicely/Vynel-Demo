// The ONE home for the marketplace rule file's provenance marker — the
// first line of every installed rule. It is what separates a
// marketplace-installed rule from the user's own hand-written `.md` in the
// same folder: only marked files annotate as Installed, only marked files
// may be overwritten by a re-install, and only marked files may be deleted
// by uninstall (the agents slug-collision lesson — a user's own file must
// never flip a card or be destroyed by a colliding catalog id).

const MARKER_PREFIX = '<!-- vynel-marketplace-rule:'

export function buildRuleFileContent(
  ruleId: string,
  version: string,
  ruleMarkdown: string,
): string {
  return `${MARKER_PREFIX} ${ruleId} v${version} -->\n\n${ruleMarkdown}\n`
}

export type RuleFileMarker = {
  ruleId: string
  version: string
}

/** Parses the first line of a rule file. `null` = no marker — the file is
 * hand-authored (or foreign) and must be left alone. A leading UTF-8 BOM
 * (a Windows-editor re-save) is stripped so the installed file keeps
 * annotating; a trailing `\r` (CRLF re-save) is eaten by the `\s*$`. */
export function parseRuleFileMarker(content: string): RuleFileMarker | null {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const newlineIndex = withoutBom.indexOf('\n')
  const firstLine = withoutBom.slice(0, newlineIndex === -1 ? withoutBom.length : newlineIndex)
  if (!firstLine.startsWith(MARKER_PREFIX)) return null
  const match = /^<!-- vynel-marketplace-rule: (\S+) v(\S+) -->\s*$/.exec(firstLine)
  if (match === null) return null
  return { ruleId: match[1]!, version: match[2]! }
}
