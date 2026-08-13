// Public surface of `@vynel/phases` — the phases leaf (a workspace's
// engineering build plan, phase by phase). Consumers reach the package only
// through this barrel; schema, repositories and the concern folders are
// internal (imported relatively).

export type { StructuralLogger } from './phases-types.js'

// Row types — the HTTP serializers type their inputs against these (the
// plans `Plan` re-export precedent). Repositories stay internal.
export type { Phase, PhaseStatus } from './repositories/index.js'

export {
  PHASE_CREATED,
  PHASE_UPDATED,
  PHASE_COMPLETED,
  PHASE_DELETED,
  type PhaseCreatedPayload,
  type PhaseUpdatedPayload,
  type PhaseCompletedPayload,
  type PhaseDeletedPayload,
} from './phases-events.js'

// CRUD + read ops (sync).
export {
  createPhase,
  type CreatePhaseInput,
  PHASE_TITLE_MAX_LENGTH,
  PHASE_DESCRIPTION_MAX_LENGTH,
} from './lifecycle/create-phase.js'
export { updatePhase, type UpdatePhaseInput } from './lifecycle/update-phase.js'
export { deletePhase } from './lifecycle/delete-phase.js'
export { listPhases, getPhaseOrThrow } from './queries/list-phases.js'
