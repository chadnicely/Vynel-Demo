// The ONE home for turning a request's `{ scope, workspaceId? }` pair into the
// on-disk target the `.claude/` config ops take (`resolveRulesRoot`,
// `resolveCommandsRoot`, `resolveSkillsRoot` all answer the same question).
// Shared by the rules, commands and skills routes so the pairing rule — a
// workspace scope NEEDS an id, and that workspace must be the caller's — is
// stated once, not per route. Ownership goes through the workspaces leaf's
// own guard: an unknown or foreign workspace reads as 404, never a leak.

import type { Database } from '@vynel/db'
import { ValidationError } from '@vynel/errors'
import { getWorkspaceById } from '@vynel/workspaces'

export type ScopeTargetInput = {
  scope: 'user' | 'workspace'
  workspaceId?: string | undefined
}

export type ScopeTarget =
  | { scope: 'user'; workspaceId: null; workspacePath: undefined }
  | { scope: 'workspace'; workspaceId: string; workspacePath: string }

/** The `workspacePath?` argument the `.claude/` config ops take —
 *  `exactOptionalPropertyTypes` means the user scope must OMIT the key
 *  rather than pass undefined. */
export function workspacePathOf(target: ScopeTarget): { workspacePath?: string } {
  return target.scope === 'workspace' ? { workspacePath: target.workspacePath } : {}
}

export async function resolveScopeTarget(
  db: Database,
  userId: string,
  input: ScopeTargetInput,
): Promise<ScopeTarget> {
  // A workspace turn's ambient stamp may attach a workspaceId to a call that
  // asked for the user scope — the scope word is the caller's intent.
  if (input.scope === 'user') return { scope: 'user', workspaceId: null, workspacePath: undefined }
  if (!input.workspaceId) {
    throw new ValidationError('workspaceId is required when scope is "workspace".')
  }
  const workspace = await getWorkspaceById(db, input.workspaceId, userId)
  return {
    scope: 'workspace',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
  }
}
