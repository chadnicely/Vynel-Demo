// Renders an installed agent's TRANSPARENCY MIRROR — the Claude-Code-style
// agent markdown written to `.claude/agents/<slug>.md` so a marketplace/
// curated install is visible on disk exactly like skills' SKILL.md. The
// ONE place the Vynel agent row is translated to the file shape.
//
// The mirror is NOT the functional source: the DB row is truth, resolved
// into `query({ agents })` by `resolveEnabledAgentsForSession`. The SDK
// (settingSources: user/project/local — `build-claude-sdk-options.ts`)
// DOES discover `.claude/agents/*.md`, but a programmatic agent with the
// same name takes precedence (Agent SDK subagents doc, verified
// 2026-07-14) — so while the agent is enabled the mirror is always
// shadowed and never double-registers. Lifecycle sync keeps the file
// present exactly while the row is enabled (`agent-mirror-on-disk.ts`),
// so a disabled/deleted agent can never go live from disk.
//
// Frontmatter emits only keys Claude Code's subagent file format is
// documented to read (name, description, tools, model) — an invented key
// could invalidate the frontmatter in non-Vynel sessions. String values
// are JSON-quoted (a strict subset of YAML double-quoted scalars), so a
// description with colons or quotes can never break the YAML.

export const AGENT_MIRROR_MANAGED_MARKER = 'Managed by Vynel'

export type AgentMirrorSource = {
  slug: string
  name: string
  description: string
  prompt: string
  model?: string | null
  allowedTools?: string[] | null
}

function yamlQuote(value: string): string {
  return JSON.stringify(value)
}

// The marker line is a YAML comment, so quoting isn't needed — but it
// MUST stay one line: a line break smuggled through the manifest's
// free-text `name` (only length-validated) would end the comment and
// inject a REAL frontmatter key (e.g. `tools: Bash`) into a file plain
// Claude Code sessions load live. YAML 1.1 also breaks on NEL/LS/PS,
// so those are collapsed alongside \r\n.
function toSingleCommentLine(value: string): string {
  return value.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
}

/** True for a file THIS renderer wrote: the frontmatter opens with the
 *  managed-marker comment. A hand-authored file whose prompt merely mentions
 *  the phrase is not a mirror — `includes()` once made such a file vanish
 *  from the "On disk" list and get overwritten by a same-slug create. */
export function isAgentMirrorMarkdown(content: string): boolean {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  return /^---\r?\n# Managed by Vynel\b/.test(withoutBom)
}

export function renderAgentMirrorMarkdown(source: AgentMirrorSource): string {
  const lines = [
    '---',
    `# ${AGENT_MIRROR_MANAGED_MARKER} — "${toSingleCommentLine(source.name)}" was installed through Vynel.`,
    '# The Vynel database is the source of truth; edits here are NOT read back.',
    '# Removing or disabling the agent in Vynel removes this file.',
    `name: ${yamlQuote(source.slug)}`,
    `description: ${yamlQuote(source.description)}`,
  ]
  if (source.allowedTools !== null && source.allowedTools !== undefined && source.allowedTools.length > 0) {
    lines.push(`tools: ${yamlQuote(source.allowedTools.join(', '))}`)
  }
  if (source.model !== null && source.model !== undefined) {
    lines.push(`model: ${yamlQuote(source.model)}`)
  }
  lines.push('---', '', source.prompt.trimEnd(), '')
  return lines.join('\n')
}
