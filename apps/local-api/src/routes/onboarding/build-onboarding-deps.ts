// Builds the `OnboardingDeps` the onboarding step handlers run against. This is
// the api-edge composition point (the build-schedule-fire-deps precedent): it
// binds the REAL core-users ops — profile write + gate flip — that the
// onboarding LEAF declares only structurally so it never imports a sibling
// package (invariant #2). Apps may import anything. Two steps since
// 2026-08-24: the workspace/memory/skills/channel/schedule bindings left with
// their steps.

import { updateUserProfile, markUserOnboardingComplete } from '@vynel/core/users'
import type { OnboardingDeps } from '@vynel/onboarding'
import type { Logger } from 'pino'

export function buildOnboardingDeps(logger: Logger): OnboardingDeps {
  return {
    logger,
    updateUserProfile,
    markUserOnboardingComplete,
  }
}
