// SYNC read of a scope's `.claude/commands/` folder — the Commands view's
// source, and (by design) the "/" mention menu's data source when that lands.
// A command is one `.md` file; a subfolder namespaces its commands the way
// Claude Code names them (`git/commit.md` → `git:commit`). Lenient: a missing
// folder or unreadable file contributes nothing.
//
// Frontmatter: Claude Code commands may open with a `---` YAML block carrying
// `description` and `argument-hint`. Only those two scalar keys matter here —
// a full YAML parser would be a dependency for two lines, so this reads
// simple `key: value` pairs and ignores everything else.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { resolveCommandsRoot } from './resolve-commands-root.js'

export type CommandFileForScope = {
  /** The slash name without the slash: relative path minus `.md`, `/` → `:`. */
  commandName: string
  /** Path relative to the commands root (forward slashes). */
  relativePath: string
  description: string | null
  argumentHint: string | null
  /** First non-empty body line, truncated — the row's one-line preview. */
  bodyPreview: string | null
}

// Namespacing nests one folder in practice; the bound only stops a symlink
// cycle from walking forever.
const MAX_FOLDER_DEPTH = 4

export function listCommandsForScope(
  scope: SkillScope,
  workspacePath?: string,
): CommandFileForScope[] {
  const commandsRoot = resolveCommandsRoot(scope, workspacePath)
  const commands: CommandFileForScope[] = []
  collectCommandFiles(commandsRoot, '', 0, commands)
  return commands.sort((a, b) => a.commandName.localeCompare(b.commandName))
}

function collectCommandFiles(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  out: CommandFileForScope[],
): void {
  if (depth > MAX_FOLDER_DEPTH) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) {
      collectCommandFiles(path.join(absoluteDir, entry.name), relativePath, depth + 1, out)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    let content: string
    try {
      content = readFileSync(path.join(absoluteDir, entry.name), 'utf8')
    } catch {
      continue
    }
    out.push(parseCommandFile(relativePath, content))
  }
}

function parseCommandFile(relativePath: string, content: string): CommandFileForScope {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const lines = withoutBom.split('\n').map((line) => line.replace(/\r$/, ''))

  let description: string | null = null
  let argumentHint: string | null = null
  let bodyStartIndex = 0
  if (lines[0] === '---') {
    const closingIndex = lines.indexOf('---', 1)
    if (closingIndex !== -1) {
      for (const line of lines.slice(1, closingIndex)) {
        const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line)
        if (match === null) continue
        if (match[1] === 'description') description = stripQuotes(match[2]!)
        if (match[1] === 'argument-hint') argumentHint = stripQuotes(match[2]!)
      }
      bodyStartIndex = closingIndex + 1
    }
  }

  const firstBodyLine = lines.slice(bodyStartIndex).find((line) => line.trim().length > 0) ?? null
  return {
    commandName: relativePath.slice(0, -'.md'.length).replaceAll('/', ':'),
    relativePath,
    description: description !== null && description.length > 0 ? description : null,
    argumentHint: argumentHint !== null && argumentHint.length > 0 ? argumentHint : null,
    bodyPreview: firstBodyLine === null ? null : firstBodyLine.trim().slice(0, 160),
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  const isQuoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  return isQuoted ? trimmed.slice(1, -1) : trimmed
}
