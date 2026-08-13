// Public surface of `@vynel/features` — the features leaf (the catalog of
// what the workspace's app should have, each a big-form write-up, optionally
// linked to the build-plan phase that delivers it). Consumers reach the
// package only through this barrel; schema, repositories and the concern
// folders are internal (imported relatively).

export type { StructuralLogger } from './features-types.js'

// Row types — the HTTP serializers type their inputs against these (the
// plans `Plan` re-export precedent). Repositories stay internal.
export type { Feature, FeatureStatus } from './repositories/index.js'

export {
  FEATURE_CREATED,
  FEATURE_UPDATED,
  FEATURE_COMPLETED,
  FEATURE_DELETED,
  type FeatureCreatedPayload,
  type FeatureUpdatedPayload,
  type FeatureCompletedPayload,
  type FeatureDeletedPayload,
} from './features-events.js'

// CRUD + read ops (sync).
export {
  createFeature,
  type CreateFeatureInput,
  FEATURE_TITLE_MAX_LENGTH,
  FEATURE_DESCRIPTION_MAX_LENGTH,
} from './lifecycle/create-feature.js'
export { updateFeature, type UpdateFeatureInput } from './lifecycle/update-feature.js'
export { deleteFeature } from './lifecycle/delete-feature.js'
export { listFeatures, getFeatureOrThrow } from './queries/list-features.js'
