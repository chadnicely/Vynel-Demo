// Re-exports the row types from the `users` domain schema + the resolved-
// preferences shape that's specific to the core layer. Consumer domains
// import `User` from `@vynel/db/repositories/users` (per the public
// surface), so this file is mainly for internal core-layer convenience.
// Per `docs/blueprints/users/coding.md §3`.

export type { User, NewUser } from '@vynel/db/repositories/users'
export type { UserPreference, NewUserPreference } from '@vynel/db/repositories/users'

// The resolved-preferences shape produced by `getUserPreferences` with
// defaults filled. Created here so other core ops can reference it
// without a circular import to the op file. The op file in turn
// re-exports this type from `@vynel/core/users` for consumer use.
export interface ResolvedUserPreferences {
  theme: 'light' | 'dark' | 'system'
  defaultWorkspaceId: string | null
  chatStreamingEnabled: boolean
  reducedMotion: boolean
}
