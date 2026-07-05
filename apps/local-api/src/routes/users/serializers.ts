// Maps a `User` row to its HTTP response shape (Dates rendered as ISO
// strings). Split into its own file per this repo's per-route-group
// convention (every sibling group under `routes/*` carries a
// `serializers.ts`) — the source route inlined this in `index.ts`; the
// shape is unchanged.

import type { User } from '@vynel/core/users'
import type { UserResponse } from './schemas.js'

export function serializeUserForResponse(user: User): UserResponse {
  return {
    id: user.id,
    displayName: user.displayName,
    emailAddress: user.emailAddress,
    locale: user.locale,
    timezone: user.timezone,
    hasCompletedOnboarding: user.hasCompletedOnboarding,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}
