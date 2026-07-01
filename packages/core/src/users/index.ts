// Public surface of the `users` domain (core layer). Consumer domains
// import per-op via `@vynel/core/users` per the `exports` map in
// `packages/core/package.json`.

export { getOrCreateLocalUser } from './get-or-create-local-user.js'
export type { GetOrCreateLocalUserDependencies } from './get-or-create-local-user.js'
// Published cross-domain read surface (null-safe) — used by schedules' prompt renderer.
export { findUserById } from './find-user-by-id.js'

export { updateUserProfile } from './update-user-profile.js'
export type {
  UpdateUserProfileInput,
  UpdateUserProfileDependencies,
} from './update-user-profile.js'

export { markUserOnboardingComplete } from './mark-user-onboarding-complete.js'

export { getUserPreferences, DEFAULT_PREFERENCES } from './get-user-preferences.js'
export type { ResolvedUserPreferences } from './get-user-preferences.js'

export { setUserPreferences } from './set-user-preferences.js'
export type { SetUserPreferencesInput } from './set-user-preferences.js'

export { detectOsUsername, detectOsLocale, detectOsTimezone } from './os-detection.js'

export type { User, NewUser, UserPreference, NewUserPreference } from './users-types.js'
