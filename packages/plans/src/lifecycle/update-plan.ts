// Core op — patch a plan (owner-scoped): title, detail, planDate, status.
// sync. Status is the one home for the completion rule: a transition TO
// 'done' stamps `completedAt` and emits `plan.completed`; leaving 'done'
// clears it (reopening); every other patch emits `plan.updated`. Patch +
// event co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as plansRepository from '../repositories/index.js'
import {
  PLAN_TITLE_MAX_LENGTH,
  PLAN_DETAIL_MAX_LENGTH,
  assertValidPlanDate,
} from './create-plan.js'
import {
  PLAN_COMPLETED,
  PLAN_UPDATED,
  type PlanCompletedPayload,
  type PlanUpdatedPayload,
} from '../plans-events.js'
import type { Database } from '@vynel/db'
import type { NewPlan, Plan, PlanStatus } from '../repositories/index.js'
import type { StructuralLogger } from '../plans-types.js'

export interface UpdatePlanInput {
  planId: string
  userId: string
  title?: string
  detail?: string | null
  planDate?: string
  status?: PlanStatus
  taskId?: string | null // null detaches the plan from its task
}

export function updatePlan(
  db: Database,
  input: UpdatePlanInput,
  deps: { logger?: StructuralLogger } = {},
): Plan {
  const plan = plansRepository.findPlanById(db, input.planId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!plan || plan.userId !== input.userId) {
    throw new NotFoundError('plan', input.planId)
  }

  const now = new Date()
  const patch: Partial<NewPlan> = { updatedAt: now }

  if (input.title !== undefined) {
    const title = input.title.trim()
    if (title.length === 0) {
      throw new ValidationError('A plan needs a title. Add a short description of the intent.')
    }
    if (title.length > PLAN_TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Plan titles are capped at ${PLAN_TITLE_MAX_LENGTH} characters. Put the rest in the detail.`,
      )
    }
    patch.title = title
  }
  if (input.detail !== undefined) {
    const detail = input.detail?.trim() || null
    if (detail && detail.length > PLAN_DETAIL_MAX_LENGTH) {
      throw new ValidationError(`Plan detail is capped at ${PLAN_DETAIL_MAX_LENGTH} characters.`)
    }
    patch.detail = detail
  }
  if (input.planDate !== undefined) {
    assertValidPlanDate(input.planDate)
    patch.planDate = input.planDate
  }
  if (input.taskId !== undefined) patch.taskId = input.taskId

  const isCompleting = input.status === 'done' && plan.status !== 'done'
  if (input.status !== undefined) {
    patch.status = input.status
    if (isCompleting) patch.completedAt = now
    if (input.status !== 'done' && plan.status === 'done') patch.completedAt = null
  }

  const updated = withTransaction(db, (tx) => {
    const row = plansRepository.updatePlan(tx, input.planId, patch)
    if (isCompleting) {
      const payload: PlanCompletedPayload = {
        planId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        planDate: row.planDate,
        completedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: PLAN_COMPLETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    } else {
      const payload: PlanUpdatedPayload = {
        planId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        planDate: row.planDate,
        status: row.status,
        updatedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: PLAN_UPDATED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    }
    return row
  })

  deps.logger?.info({ planId: updated.id, status: updated.status }, 'plan updated')
  return updated
}
