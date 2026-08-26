// The `.claude/agents/` folder for a scope, from a path the caller already
// holds — the hand-authored-file doors run on a route that resolved the
// workspace moments ago (`resolveScopeTarget`), unlike the mirror ops that
// resolve the workspace from a row's loose ref (`resolve-agent-mirror-path`).
// Both land on the same folder; this one just never touches the DB.

import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import { isSafeFileStem } from '@vynel/contracts/fs/safe-file-stem'
import type { AgentScope } from '../agents-types.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'

export function assertSafeAgentFileSlug(slug: string): void {
  if (!isSafeFileStem(slug)) {
    throw new ValidationError(
      `Agent file name '${slug}' is not a safe file name — use letters, digits and dashes ` +
        '(no slashes, no leading dot).',
    )
  }
}

export function resolveAgentFilesRoot(scope: AgentScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'agents')
  }
  if (!workspacePath) {
    throw new Error('resolveAgentFilesRoot: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.claude', 'agents')
}

export function resolveAgentFilePath(
  scope: AgentScope,
  slug: string,
  workspacePath?: string,
): string {
  assertSafeAgentFileSlug(slug)
  return path.join(resolveAgentFilesRoot(scope, workspacePath), `${slug}.md`)
}
