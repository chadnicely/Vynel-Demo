// Lists the agents available in a (user, workspace) session — the union
// of user-scope agents (available everywhere) + this workspace's
// workspace-scope agents, live rows only, newest first. Powers the
// Agents panel. Spec: `docs/agent-base/agents.md`.
//
// Bounded list (curated catalog + the user's own agents) — no cursor
// pagination needed in Phase 1.

import type { Database } from '@vynel/db'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { AgentRow } from '@vynel/db/repositories/agents'

export type ListAgentsForWorkspaceInput = {
  userId: string
  // null = user-scope agents ONLY — the GLOBAL Agents surface has no
  // workspace to union in (mirrors the repo's null convention).
  workspaceId: string | null
  /** Drop user-scope rows: what the workspace OWNS (its menu) rather than what
   *  a session there resolves (the "@" picker and Claude's own tool). */
  ownedByWorkspaceOnly?: boolean
}

export async function listAgentsForWorkspace(
  db: Database,
  input: ListAgentsForWorkspaceInput,
): Promise<AgentRow[]> {
  return agentsRepository.listAgentsForUserAndWorkspace(db, input)
}
