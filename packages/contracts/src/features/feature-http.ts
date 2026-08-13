// HTTP response shapes for the `features` domain. Single source of truth for
// the serialized responses: `apps/local-api` types its serializers' returns
// as these; consumers cast SDK responses to them (the plans
// cast-from-contracts precedent).
//
// TWO shapes by design: a feature's `description` is big-form (up to 50k
// chars), so the LIST surface carries a bounded `descriptionPreview` and the
// single-feature GET carries the full text — keeps list_features MCP
// payloads sane.
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db`
// dep (kept in sync with `packages/features/src/schema/features.ts`).

export type FeatureStatus = 'open' | 'in-progress' | 'done'

export interface FeatureResponse {
  id: string
  userId: string
  workspaceId: string
  title: string
  /** The full big-form write-up. */
  description: string
  /** Loose ref to the build-plan phase delivering this feature — null = not yet placed. */
  phaseId: string | null
  status: FeatureStatus
  sessionId: string | null
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

export interface FeatureListItemResponse extends Omit<FeatureResponse, 'description'> {
  /** The description's first line(s), bounded — read the full text via the single-feature GET. */
  descriptionPreview: string
}
