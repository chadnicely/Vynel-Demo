// The counting itself, shared by the user- and workspace-scoped twins so the
// two can never drift.
//
// ONE RULE, no exceptions: every count calls the SAME core read the section's
// own list route calls, with the same arguments, and takes its length — so
// the number in the menu and the rows behind it come from one source and
// cannot disagree. `sessions` originally broke that rule with a bespoke
// `chat_sessions` count and was the only count that drifted (it advertised
// every scope's sessions while the Global library lists only the root's own
// children — and entries collapse continuity chains, so no row count can
// answer it at all). The curation now lives once, in
// `selectSessionsForScope`.

import { getSessionsOverview } from '@vynel/session/overview'
import { selectSessionsForScope } from '@vynel/contracts/chat/sessions-overview'
import { listAgentsForWorkspace } from '@vynel/agents'
import { listInstalledSkillsForContext, listAllRuleFilesForScope } from '@vynel/skills'
import { listApps } from '@vynel/apps'
import type { Database } from '@vynel/db'

export type SectionCountsScope = {
  userId: string
  /** The drilled workspace, or null for the Global menu. */
  workspace: { id: string; path: string } | null
}

export type SectionCounts = {
  sessions: number
  agents: number
  skills: number
  rules: number
  apps?: number
}

export async function countSections(
  db: Database,
  scope: SectionCountsScope,
): Promise<SectionCounts> {
  const { userId, workspace } = scope
  const workspaceId = workspace?.id ?? null

  // `ownedByWorkspaceOnly` mirrors the MENU's lists: a scope's row counts what
  // that scope owns, never what merely resolves inside it.
  const agents = await listAgentsForWorkspace(db, {
    userId,
    workspaceId,
    ownedByWorkspaceOnly: true,
  })
  const skills = listInstalledSkillsForContext(db, {
    userId,
    workspaceId,
    ownedByWorkspaceOnly: true,
  })
  const rules =
    workspace === null
      ? listAllRuleFilesForScope('user')
      : listAllRuleFilesForScope('workspace', workspace.path)

  const sessions = selectSessionsForScope(getSessionsOverview(db, { userId }), workspaceId)

  return {
    sessions: sessions.length,
    agents: agents.length,
    skills: skills.length,
    rules: rules.length,
    ...(workspace !== null ? { apps: listApps(db, { userId, workspaceId: workspace.id }).length } : {}),
  }
}
