// Core op — remove a plan (owner-scoped). Hard delete: a plan row is not
// irrecoverable user content (docs/module-notes/plans.md). Tasks that carried
// this plan's loose `planId` ref keep it dangling harmlessly — no cascade by
// design (sibling leaves, no FK). Delete + `plan.deleted` co-commit in ONE
// transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as plansRepository from '../repositories/index.js'
import { PLAN_DELETED, type PlanDeletedPayload } from '../plans-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../plans-types.js'

export function deletePlan(
  db: Database,
  input: { planId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const plan = plansRepository.findPlanById(db, input.planId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!plan || plan.userId !== input.userId) {
    throw new NotFoundError('plan', input.planId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    plansRepository.hardDeletePlan(tx, plan.id)
    const payload: PlanDeletedPayload = {
      planId: plan.id,
      userId: plan.userId,
      workspaceId: plan.workspaceId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: PLAN_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ planId: plan.id }, 'plan deleted')
}
