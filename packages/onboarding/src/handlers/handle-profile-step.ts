// Step 2 (profile) handler — UPDATES the existing user (the single user exists
// from boot — D14; onboarding never calls getOrCreateLocalUser per users D7).
// `updateUserProfile` is injected via OnboardingDeps (invariant #2 — no
// sibling-leaf import of @vynel/core). Sync (the op is DB-only).
// Spec: blueprint.md §6.4.

import type { Database } from '@vynel/db'
import type { ProfileStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export function handleProfileStep(
  db: Database,
  run: OnboardingRun,
  input: ProfileStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'updateUserProfile'>,
): OnboardingRun {
  deps.updateUserProfile(
    db,
    run.userId,
    { displayName: input.displayName, locale: input.locale, timezone: input.timezone },
    deps,
  )
  return advanceRun(db, run, 'profile', input)
}
