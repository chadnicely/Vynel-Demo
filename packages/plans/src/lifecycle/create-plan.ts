// Core op — put a plan on the date-wise list (assistant via its MCP tools, or
// the user via UI/CLI). sync. Insert + `plan.created` co-commit in ONE
// transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as plansRepository from '../repositories/index.js'
import { PLAN_CREATED, type PlanCreatedPayload } from '../plans-events.js'
import type { Database } from '@vynel/db'
import type { Plan, PlanSource } from '../repositories/index.js'
import type { StructuralLogger } from '../plans-types.js'

export const PLAN_TITLE_MAX_LENGTH = 200
export const PLAN_DETAIL_MAX_LENGTH = 4000

// The ONE home for the calendar-day shape — the route schemas mirror it.
export const PLAN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function assertValidPlanDate(planDate: string): void {
  if (!PLAN_DATE_PATTERN.test(planDate)) {
    throw new ValidationError('Plan dates use the YYYY-MM-DD format, e.g. 2026-07-23.')
  }
}

export interface CreatePlanInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  title: string
  detail?: string
  planDate: string // YYYY-MM-DD — the day this plan belongs to
  source: PlanSource
  sessionId?: string // the chat session whose turn created the plan
}

export function createPlan(
  db: Database,
  input: CreatePlanInput,
  deps: { logger?: StructuralLogger } = {},
): Plan {
  const title = input.title.trim()
  if (title.length === 0) {
    throw new ValidationError('A plan needs a title. Add a short description of the intent.')
  }
  if (title.length > PLAN_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `Plan titles are capped at ${PLAN_TITLE_MAX_LENGTH} characters. Put the rest in the detail.`,
    )
  }
  const detail = input.detail?.trim() || null
  if (detail && detail.length > PLAN_DETAIL_MAX_LENGTH) {
    throw new ValidationError(`Plan detail is capped at ${PLAN_DETAIL_MAX_LENGTH} characters.`)
  }
  assertValidPlanDate(input.planDate)

  const now = new Date()
  const plan = withTransaction(db, (tx) => {
    const inserted = plansRepository.insertPlan(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      title,
      detail,
      planDate: input.planDate,
      status: 'open',
      source: input.source,
      sessionId: input.sessionId ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: PlanCreatedPayload = {
      planId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      planDate: inserted.planDate,
      source: inserted.source,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: PLAN_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ planId: plan.id, planDate: plan.planDate, source: plan.source }, 'plan created')
  return plan
}
