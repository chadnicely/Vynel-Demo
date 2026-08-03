// `resolveColleagueAgent` — ONE home for the @mention agent-resolution rule
// (persona-sessions): workspace scope preferred, then user scope (a
// user-scoped agent is available in every workspace — the same union
// `listAgentsForWorkspace` exposes). Three callers spell it: the agent-run
// job, the tick's colleague-target fork, and the report route's caller
// labeling — one home so a scope-rule change can never drift.

import type { Database } from '@vynel/db'
import { findAgentBySlug } from '@vynel/agents'
import type { AgentRow } from '@vynel/db/repositories/agents'

export type ResolveColleagueAgentInput = {
  userId: string
  /** The resolution scope — the colleague's grounding workspace; null resolves
   *  at the user scope only. */
  workspaceId: string | null
  slug: string
}

export async function resolveColleagueAgent(
  db: Database,
  input: ResolveColleagueAgentInput,
): Promise<AgentRow | null> {
  return (
    (input.workspaceId !== null
      ? await findAgentBySlug(db, {
          userId: input.userId,
          workspaceId: input.workspaceId,
          slug: input.slug,
        })
      : null) ??
    (await findAgentBySlug(db, { userId: input.userId, workspaceId: null, slug: input.slug }))
  )
}
