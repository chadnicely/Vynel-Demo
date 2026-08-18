// Read ops — the two list surfaces. Workspace-scoped backs the in-session MCP
// `list_plans`; user-scoped spans every workspace + the global
// (null-workspace) scope and backs the panel + `list_my_plans`.

import * as plansRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Plan, PlanStatus } from '../repositories/index.js'

export function listPlans(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    status?: PlanStatus
    planDate?: string
    taskId?: string
  },
): Plan[] {
  return plansRepository.listPlansForWorkspace(db, input)
}

export function listPlansForUser(
  db: Database,
  input: { userId: string; status?: PlanStatus; planDate?: string; taskId?: string },
): Plan[] {
  return plansRepository.listPlansForUser(db, input)
}
