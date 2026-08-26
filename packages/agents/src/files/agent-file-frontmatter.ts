// The ONE home for reading a Claude Code subagent file (`.claude/agents/
// <slug>.md`): a `---` frontmatter block — `name`, `description`, `tools`,
// `model`, plus keys Vynel does not model — then the system prompt. Also
// where "is this file Vynel's own mirror?" is answered (the managed marker
// the renderer writes). Flat `key: value` lines only; a full YAML parser
// would be a dependency for four scalars.

import { isAgentMirrorMarkdown } from '../internal/render-agent-mirror-markdown.js'

export type AgentFileParts = {
  name: string | null
  description: string | null
  /** The `tools` line split on commas, or null when absent. */
  tools: string[] | null
  model: string | null
  /** The system prompt after the frontmatter block. */
  body: string
  /** True when the file is a Vynel mirror (the DB row is its truth). */
  isManagedMirror: boolean
}

export function parseAgentFile(content: string): AgentFileParts {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const lines = withoutBom.split('\n').map((line) => line.replace(/\r$/, ''))
  const fields: Record<string, string> = {}
  let bodyStartIndex = 0
  if (lines[0] === '---') {
    const closingIndex = lines.indexOf('---', 1)
    if (closingIndex !== -1) {
      for (const line of lines.slice(1, closingIndex)) {
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
        if (match !== null) fields[match[1]!] = unquote(match[2]!)
      }
      bodyStartIndex = closingIndex + 1
    }
  }
  const tools = fields['tools']
  return {
    name: nonEmpty(fields['name']),
    description: nonEmpty(fields['description']),
    tools:
      tools === undefined
        ? null
        : tools
            .split(',')
            .map((tool) => tool.trim())
            .filter((tool) => tool.length > 0),
    model: nonEmpty(fields['model']),
    body: lines.slice(bodyStartIndex).join('\n').replace(/^\s*\n/, ''),
    isManagedMirror: isAgentMirrorMarkdown(withoutBom),
  }
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed))
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
