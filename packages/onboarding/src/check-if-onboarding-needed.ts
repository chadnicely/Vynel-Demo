// `checkIfOnboardingNeeded` — reads `users.hasCompletedOnboarding` (D14 — the
// gate flag) + the in-progress run. The first-launch gate middleware + the web
// client both call it. Sync. Spec: blueprint.md §6.1 + §12.1.

import type { Database } from '@vynel/db'
import { findUserById } from '@vynel/db/repositories/users'
import { findInProgressRunForUser } from '@vynel/db/repositories/onboarding'

export interface OnboardingNeededStatus {
  needsOnboarding: boolean
  inProgressRunId: string | null
}

export function checkIfOnboardingNeeded(db: Database, userId: string): OnboardingNeededStatus {
  const user = findUserById(db, userId)
  const needsOnboarding = !user || !user.hasCompletedOnboarding
  const inProgress = findInProgressRunForUser(db, userId)
  return { needsOnboarding, inProgressRunId: inProgress?.id ?? null }
}
