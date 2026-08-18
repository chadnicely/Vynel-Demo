// Public surface of `@vynel/provider-preferences` — the user's default-provider
// preference (find / get / set) over the kernel `provider_preferences` table.
// Surfaces (the api routes, a future db-direct CLI) call these `(db, …)`
// functions directly.
//
// WHY only logic lives here (not schema/repos): `provider_preferences` FKs to
// the users hub — its schema + repositories therefore stay in the kernel
// (`@vynel/db/schema/providers`, `@vynel/db/repositories/providers`). This
// package is the management logic that reads them + the provider seam.
//
// SCOPE: preferences ONLY. Provider STATUS (auth / availability) and SKILLS
// discovery are separate concerns and live with their own domains — deliberately
// NOT mixed in here.

export type {
  ProviderPreference,
  NewProviderPreference,
  ProviderDefaultSettings,
  AiAgentProviderId,
} from './provider-preferences-types.js'

// Raw read (null when the user has no preference)…
export { findDefaultProviderForUser } from './find-default-provider-for-user.js'
// …and the non-null sibling that falls back to DEFAULT_PROVIDER_ID ('claude').
export { getDefaultProviderForUser } from './get-default-provider-for-user.js'

export { setDefaultProviderForUser } from './set-default-provider-for-user.js'
export type { SetDefaultProviderForUserInput } from './set-default-provider-for-user.js'

// The engine-reported model roster (feeds the model picker).
export { recordDiscoveredModels, findDiscoveredModels } from './discovered-models.js'
export type { RecordDiscoveredModelsInput } from './discovered-models.js'

// The engine-reported subscription limits (feeds the account popup's Limits tab).
export { recordRateLimitSnapshot, listRateLimitSnapshots } from './rate-limit-snapshots.js'
export type { RateLimitSnapshot, RecordRateLimitSnapshotInput } from './rate-limit-snapshots.js'
