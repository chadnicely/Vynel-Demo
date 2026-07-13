// Resolves where an agent's transparency mirror lives on disk. Scope
// homes mirror skills' `resolve-skills-root.ts` convention exactly:
//   user scope      -> `~/.claude/agents/<slug>.md`
//   workspace scope -> `<workspacePath>/.claude/agents/<slug>.md`
//
// The workspace path is read from the kernel (`@vynel/db/repositories/
// workspaces`) via the row's loose `workspaceId` ref — allowed (leaf ->
// kernel), and it keeps every caller (install / update / soft-delete)
// on ONE resolution home instead of threading paths through inputs.
// Returns null when the workspace row is gone (a cascade-delete race):
// the mirror lived inside that workspace directory anyway, so there is
// nothing to manage.
//
// Path containment: slugs are kebab-validated at every entry point
// (route schema + agent manifest zod), but the slug becomes a filesystem
// segment HERE — so this file re-checks it (defense-in-depth, same
// posture as skills' SAFE_SKILL_ID). A single safe segment joined under
// the agents root can never escape it.

import path from 'node:path'
import type { Database } from '@vynel/db'
import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { ValidationError } from '@vynel/errors'
import type { AgentScope } from '../agents-types.js'
import { resolveHostHomeDir } from './resolve-host-home-dir.js'

const SAFE_AGENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type AgentMirrorLocator = {
  scope: AgentScope
  // null only for user scope; a workspace-scope locator carries its id.
  workspaceId: string | null
  slug: string
}

export function resolveAgentMirrorPath(
  db: Database,
  locator: AgentMirrorLocator,
): string | null {
  if (!SAFE_AGENT_SLUG.test(locator.slug)) {
    throw new ValidationError(
      `Refusing to mirror an agent with an unsafe slug: ${locator.slug}`,
    )
  }
  if (locator.scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'agents', `${locator.slug}.md`)
  }
  if (locator.workspaceId === null) {
    // A workspace-scope row always carries its workspaceId; treat the
    // impossible combination as "no mirror home" rather than crashing.
    return null
  }
  const workspace = findWorkspaceById(db, locator.workspaceId)
  if (!workspace) {
    return null
  }
  return path.join(workspace.path, '.claude', 'agents', `${locator.slug}.md`)
}
