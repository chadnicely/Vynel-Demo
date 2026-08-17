// The counting itself, shared by the user- and workspace-scoped twins so the
// two can never drift.
//
// ONE RULE: every count answers the SAME question the section's own list route
// answers, over the same membership — so the number in the menu and the rows
// behind it cannot disagree. `sessions` originally broke that with a bespoke
// `chat_sessions` count and was the only count that drifted (it advertised
// every scope's sessions while the Global library lists only the root's own
// children — and entries collapse continuity chains, so no row count can
// answer it at all). The curation now lives once, in
// `selectSessionsForScope`.
//
// The rule is about the QUESTION, not the call: `rules` counts file names
// rather than re-running the list read, because rules are files on disk and
// the list read opens every one of them. The shared membership predicate lives
// inside the skills module, which is what keeps the two honest.

import { countSessionsOverview } from '@vynel/session/overview'
import { listAgentsForWorkspace } from '@vynel/agents'
import { listInstalledSkillsForContext, countAllRuleFilesForScope } from '@vynel/skills'
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
  // Rules are FILES, so the count is a directory listing — never the list
  // read, which opens and parses every body to produce rows this path throws
  // away. Membership is still shared inside the module, so the number and the
  // rows cannot disagree about what counts as a rule (Kafi, 2026-08-17).
  const rules =
    workspace === null
      ? countAllRuleFilesForScope('user')
      : countAllRuleFilesForScope('workspace', workspace.path)

  // A real total, not a page length — the library scrolls now, so taking the
  // list read's length would have frozen the badge at the first page.
  const sessions = countSessionsOverview(db, { userId, scope: { workspaceId } })

  return {
    sessions,
    agents: agents.length,
    skills: skills.length,
    rules,
    ...(workspace !== null ? { apps: listApps(db, { userId, workspaceId: workspace.id }).length } : {}),
  }
}
