// Builds the `OnboardingDeps` the onboarding step handlers run against. This is
// the api-edge composition point (the build-schedule-fire-deps precedent): it
// binds the REAL sibling ops — core-users profile + gate flip, memory seeding —
// that the onboarding LEAF declares only structurally so it never imports a
// sibling package (invariant #2). Apps may import anything.

import { updateUserProfile, markUserOnboardingComplete } from '@vynel/core/users'
import { createMemoryEntry } from '@vynel/memory'
import type { OnboardingDeps } from '@vynel/onboarding'
import type { Logger } from 'pino'

export function buildOnboardingDeps(logger: Logger): OnboardingDeps {
  return {
    logger,
    updateUserProfile,
    markUserOnboardingComplete,
    createMemoryEntry,
  }
}
