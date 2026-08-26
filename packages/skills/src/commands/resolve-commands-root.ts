// Resolves the on-disk `.claude/commands/` folder for a scope — the native
// location Claude Code loads slash-command files from (user commands apply
// everywhere; workspace commands to that project). Companion to
// `../rules/resolve-rules-root.ts`; home-dir lookup routes through the shared
// `resolve-host-home-dir` seam so tests isolate to a tmpdir.
//
// A command NAME is the slash name without the slash: `git:commit` for
// `git/commit.md` — a subfolder namespaces its files the way Claude Code
// names them. So a name is one or more file stems joined by `:`, and the
// path is those stems joined by the separator.

import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'
import { isSafeFileStem, MAX_FILE_STEM_LENGTH } from '../internal/safe-file-stem.js'

// Namespacing nests one folder in practice; the bound matches the reader's
// walk depth so a name the writer accepts is one the lister would show.
export const MAX_COMMAND_NAMESPACE_DEPTH = 4
export const MAX_COMMAND_NAME_LENGTH = MAX_FILE_STEM_LENGTH * (MAX_COMMAND_NAMESPACE_DEPTH + 1)

/** `git:commit` → `['git', 'commit']`; every segment must be a safe stem. */
export function isSafeCommandName(commandName: string): boolean {
  const segments = commandName.split(':')
  if (segments.length > MAX_COMMAND_NAMESPACE_DEPTH + 1) return false
  return segments.every(isSafeFileStem)
}

export function assertSafeCommandName(commandName: string): void {
  if (!isSafeCommandName(commandName)) {
    throw new ValidationError(
      `Command name '${commandName}' is not a safe file name — use letters, digits and dashes, ` +
        'with ":" to group commands in a folder (e.g. "git:commit").',
    )
  }
}

export function resolveCommandsRoot(scope: SkillScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'commands')
  }
  if (!workspacePath) {
    throw new Error('resolveCommandsRoot: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.claude', 'commands')
}

/** The file behind a command name: `git:commit` → `<root>/git/commit.md`. */
export function resolveCommandFilePath(
  scope: SkillScope,
  commandName: string,
  workspacePath?: string,
): string {
  assertSafeCommandName(commandName)
  const segments = commandName.split(':')
  const fileName = `${segments.pop()}.md`
  return path.join(resolveCommandsRoot(scope, workspacePath), ...segments, fileName)
}
