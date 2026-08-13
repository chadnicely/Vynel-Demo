// HTTP response shapes for the `phases` domain. Single source of truth for
// the serialized responses: `apps/local-api` types its serializers' returns
// as these; consumers cast SDK responses to them (the plans
// cast-from-contracts precedent).
//
// TWO shapes by design: a phase's `description` is big-form (up to 50k
// chars), so the LIST surface carries a bounded `descriptionPreview` and the
// single-phase GET carries the full text — keeps list_phases MCP payloads
// sane.
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db`
// dep (kept in sync with `packages/phases/src/schema/phases.ts`).

export type PhaseStatus = 'open' | 'in-progress' | 'done'

export interface PhaseResponse {
  id: string
  userId: string
  workspaceId: string
  title: string
  /** The full big-form write-up. */
  description: string
  /** 0-based position in the build order. */
  orderIndex: number
  status: PhaseStatus
  sessionId: string | null
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

export interface PhaseListItemResponse extends Omit<PhaseResponse, 'description'> {
  /** The description's first line(s), bounded — read the full text via the single-phase GET. */
  descriptionPreview: string
}
