// The ONE read every skills shelf goes through: reconcile the rows with
// disk FIRST (a folder the user dropped in by hand — or one they deleted —
// shows up the moment they look; the sync writes nothing when nothing
// changed), then list. Shared by the workspace twin, the user-scoped twin,
// the menu count and the CLI so the badge and the rows can never disagree
// about what is installed.

import type { Database } from '@vynel/db'
import type { AiAgentProvider } from '@vynel/providers'
import { synchronizeSkillsWithProvider } from '../lifecycle/synchronize-skills-with-provider.js'
import type { StructuralLogger } from '../skills-types.js'
import {
  listInstalledSkillsForContext,
  type InstalledSkillWithDefinitionAndSettings,
} from './list-installed-skills-for-context.js'

export type ListInstalledSkillsSyncedInput = {
  userId: string
  /** The drilled workspace, or null for the global surface. */
  workspace: { id: string; path: string } | null
  provider: AiAgentProvider
  /** What this workspace OWNS (the menu's question) vs what resolves here. */
  ownedByWorkspaceOnly?: boolean
  logger?: StructuralLogger
}

export async function listInstalledSkillsSynced(
  db: Database,
  input: ListInstalledSkillsSyncedInput,
): Promise<InstalledSkillWithDefinitionAndSettings[]> {
  await synchronizeSkillsWithProvider(
    db,
    {
      userId: input.userId,
      workspaceId: input.workspace?.id ?? null,
      workspacePath: input.workspace?.path ?? null,
      provider: input.provider,
    },
    input.logger === undefined ? {} : { logger: input.logger },
  )
  return listInstalledSkillsForContext(db, {
    userId: input.userId,
    workspaceId: input.workspace?.id ?? null,
    ...(input.ownedByWorkspaceOnly === undefined
      ? {}
      : { ownedByWorkspaceOnly: input.ownedByWorkspaceOnly }),
  })
}
