// The counting itself, shared by the user- and workspace-scoped twins so the
// two can never drift.
//
// Every count calls the SAME core read the section's own list route calls,
// with the same arguments — the number in the menu and the rows behind it
// come from one source, so they cannot disagree. Only `sessions` gets a
// dedicated count query: it is the one unbounded set here (the others are
// tens of rows), and re-deriving its curation filters in a second place is
// exactly the drift this rule avoids.

import { countChatSessions } from '@vynel/chat'
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

  return {
    sessions: countChatSessions(db, { userId, workspaceId }),
    agents: agents.length,
    skills: skills.length,
    rules: rules.length,
    ...(workspace !== null ? { apps: listApps(db, { userId, workspaceId: workspace.id }).length } : {}),
  }
}
