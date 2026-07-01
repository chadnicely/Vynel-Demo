// Update profile fields for an existing user. Throws `NotFoundError`
// when the user is missing. Per `docs/blueprints/users/blueprint.md §5.2`.

import { updateUser, type User } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/core/errors'

// Property values can be undefined (Zod's `.optional()` produces
// `T | undefined`, which under `exactOptionalPropertyTypes: true` must
// be declared explicitly). The repo's `updateUser` ignores undefined
// fields naturally — Drizzle's `set({...patch})` omits them from the
// SQL UPDATE clause.
export interface UpdateUserProfileInput {
  displayName?: string | undefined
  emailAddress?: string | null | undefined
  locale?: string | undefined
  timezone?: string | undefined
}

export interface UpdateUserProfileDependencies {
  readonly logger?: { info: (obj: object, msg: string) => void }
}

export function updateUserProfile(
  db: Database,
  userId: string,
  input: UpdateUserProfileInput,
  deps: UpdateUserProfileDependencies = {},
): User {
  const updated = updateUser(db, userId, input)
  if (!updated) {
    throw new NotFoundError('user', userId)
  }
  deps.logger?.info({ userId }, 'user profile updated')
  return updated
}
