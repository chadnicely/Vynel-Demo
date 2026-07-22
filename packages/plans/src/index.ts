// Public surface of `@vynel/plans` — the plans leaf. Consumers reach the
// package only through this barrel; schema, repositories and the concern
// folders are internal (imported relatively).

export type { StructuralLogger } from './plans-types.js'

// Row types — the HTTP serializers type their inputs against these (the
// tasks `Task` re-export precedent). Repositories stay internal.
export type { Plan, PlanStatus, PlanSource } from './repositories/index.js'

export {
  PLAN_CREATED,
  PLAN_UPDATED,
  PLAN_COMPLETED,
  PLAN_DELETED,
  type PlanCreatedPayload,
  type PlanUpdatedPayload,
  type PlanCompletedPayload,
  type PlanDeletedPayload,
} from './plans-events.js'

// CRUD + read ops (sync).
export {
  createPlan,
  type CreatePlanInput,
  PLAN_TITLE_MAX_LENGTH,
  PLAN_DETAIL_MAX_LENGTH,
  PLAN_DATE_PATTERN,
} from './lifecycle/create-plan.js'
export { updatePlan, type UpdatePlanInput } from './lifecycle/update-plan.js'
export { deletePlan } from './lifecycle/delete-plan.js'
export { listPlans, listPlansForUser } from './queries/list-plans.js'
