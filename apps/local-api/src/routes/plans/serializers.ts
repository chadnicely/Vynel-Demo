// Response serializer for `plans` HTTP routes. Date columns emit as ISO
// strings (`planDate` is already a text day). No secret field to strip — the
// whole row is owner-visible. Single source of truth for the response shape
// is `@vynel/contracts/plans/plan-http` (the tasks precedent).

import type { Plan } from '@vynel/plans'
import type { PlanResponse } from '@vynel/contracts/plans/plan-http'

export function serializePlanForResponse(plan: Plan): PlanResponse {
  return {
    id: plan.id,
    userId: plan.userId,
    workspaceId: plan.workspaceId,
    title: plan.title,
    detail: plan.detail,
    planDate: plan.planDate,
    status: plan.status,
    source: plan.source,
    sessionId: plan.sessionId,
    completedAt: plan.completedAt ? plan.completedAt.toISOString() : null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  }
}
