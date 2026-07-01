// Called by the `onboarding` domain when the first-launch wizard
// finishes. Per `docs/blueprints/users/blueprint.md §5.3`.

import { updateUser, type User } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/core/errors'

export function markUserOnboardingComplete(db: Database, userId: string): User {
  const updated = updateUser(db, userId, { hasCompletedOnboarding: true })
  if (!updated) {
    throw new NotFoundError('user', userId)
  }
  return updated
}
