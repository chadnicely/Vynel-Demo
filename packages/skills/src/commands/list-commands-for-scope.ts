// SYNC read of a scope's `.claude/commands/` folder — the Commands view's
// source and the composer's "/" menu's data source. A command is one `.md`
// file; a subfolder namespaces its commands the way Claude Code names them
// (`git/commit.md` → `git:commit`). Lenient: a missing folder or unreadable
// file contributes nothing. Frontmatter parsing lives in
// `command-file-frontmatter.ts` (shared with the writer).

import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { isSafeFileStem } from '../internal/safe-file-stem.js'
import { parseCommandFile } from './command-file-frontmatter.js'
import {
  isSafeCommandName,
  MAX_COMMAND_NAMESPACE_DEPTH,
  resolveCommandFilePath,
  resolveCommandsRoot,
} from './resolve-commands-root.js'

export type CommandFileForScope = {
  /** The slash name without the slash: relative path minus `.md`, `/` → `:`. */
  commandName: string
  /** Path relative to the commands root (forward slashes). */
  relativePath: string
  description: string | null
  argumentHint: string | null
  /** First non-empty body line, truncated — the row's one-line preview. */
  bodyPreview: string | null
  /** The whole file — command files are small; powers the view dialog. */
  content: string
  /** The prompt after the frontmatter block — what the editor edits. */
  body: string
}

/** The scope's command FILE PATHS (relative, forward slashes) — the one
 *  predicate for "what is a command here", shared by the list and the count
 *  so the menu's number and the rows behind it can never disagree. A file
 *  whose name (or a folder on its path) the writers could not address is
 *  left out — a row the edit and delete doors cannot reach is a dead end. */
function listCommandFilePathsForScope(scope: SkillScope, workspacePath?: string): string[] {
  const relativePaths: string[] = []
  collectCommandFilePaths(resolveCommandsRoot(scope, workspacePath), '', 0, relativePaths)
  return relativePaths
}

/** How many commands this scope has — the menu badge's read, names only. */
export function countCommandsForScope(scope: SkillScope, workspacePath?: string): number {
  return listCommandFilePathsForScope(scope, workspacePath).length
}

export function listCommandsForScope(
  scope: SkillScope,
  workspacePath?: string,
): CommandFileForScope[] {
  const commandsRoot = resolveCommandsRoot(scope, workspacePath)
  const commands: CommandFileForScope[] = []
  for (const relativePath of listCommandFilePathsForScope(scope, workspacePath)) {
    let content: string
    try {
      content = readFileSync(path.join(commandsRoot, ...relativePath.split('/')), 'utf8')
    } catch {
      continue
    }
    commands.push(toCommandFile(relativePath, content))
  }
  return commands.sort((a, b) => a.commandName.localeCompare(b.commandName))
}

/** One command by name — the write door's read-back. `null` = no such file
 *  (or a name the writers could not address). */
export function readCommandFileForScope(
  scope: SkillScope,
  commandName: string,
  workspacePath?: string,
): CommandFileForScope | null {
  if (!isSafeCommandName(commandName)) return null
  try {
    const content = readFileSync(resolveCommandFilePath(scope, commandName, workspacePath), 'utf8')
    return toCommandFile(`${commandName.replaceAll(':', '/')}.md`, content)
  } catch {
    return null
  }
}

function collectCommandFilePaths(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  out: string[],
): void {
  if (depth > MAX_COMMAND_NAMESPACE_DEPTH) return
  let entries: Dirent[]
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!isSafeFileStem(entry.name)) continue
      collectCommandFilePaths(path.join(absoluteDir, entry.name), relativePath, depth + 1, out)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    if (!isSafeFileStem(entry.name.slice(0, -'.md'.length))) continue
    out.push(relativePath)
  }
}

function toCommandFile(relativePath: string, content: string): CommandFileForScope {
  const parts = parseCommandFile(content)
  const firstBodyLine = parts.body.split('\n').find((line) => line.trim().length > 0) ?? null
  return {
    commandName: relativePath.slice(0, -'.md'.length).replaceAll('/', ':'),
    relativePath,
    description: parts.description,
    argumentHint: parts.argumentHint,
    bodyPreview: firstBodyLine === null ? null : firstBodyLine.trim().slice(0, 160),
    content,
    body: parts.body.replace(/^\s*\n/, ''),
  }
}
