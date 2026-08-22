// The workspace brief as this leaf hands it out — the kernel stores `answers`
// and `plan` as opaque JSON; THIS is the typed boundary, the one place the
// row becomes the contract's shapes. `findWorkspaceBrief` is the read behind
// `GET /workspaces/:id/brief` (and its `get_workspace_brief` tool): null
// means the workspace was not made by the wizard.

import type { Database } from '@vynel/db'
import * as workspaceBriefsRepository from '@vynel/db/repositories/workspaces'
import type { WorkspaceBriefRow } from '@vynel/db/repositories/workspaces'
import type {
  WorkspaceBriefAnswers,
  WorkspacePlan,
} from '@vynel/contracts/workspaces/workspace-brief'

export type WorkspaceBrief = {
  id: string
  userId: string
  workspaceId: string
  answers: WorkspaceBriefAnswers
  plan: WorkspacePlan
  brief: string
  createdAt: Date
}

export function toWorkspaceBrief(row: WorkspaceBriefRow): WorkspaceBrief {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    // The scaffold wrote exactly these shapes (validated at the api boundary);
    // the kernel just kept them opaque.
    answers: row.answers as WorkspaceBriefAnswers,
    plan: row.plan as WorkspacePlan,
    brief: row.brief,
    createdAt: row.createdAt,
  }
}

export function findWorkspaceBrief(db: Database, workspaceId: string): WorkspaceBrief | null {
  const row = workspaceBriefsRepository.findWorkspaceBriefByWorkspaceId(db, workspaceId)
  return row === null ? null : toWorkspaceBrief(row)
}
