// `completeOnboardingRun` — the completion seam. Called by the dispatcher once
// the last step's `advanceRun` has already set the run `completed`. Flips
// `users.hasCompletedOnboarding` via the injected `markUserOnboardingComplete`
// (OnboardingDeps — invariant #2: no sibling-leaf import of @vynel/core; opens
// the first-launch gate) and returns the run. Does NOT re-advance.
// Sync. Spec: blueprint.md §6.1 + D14.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findOnboardingRunById, type OnboardingRun } from '@vynel/db/repositories/onboarding'
import type { OnboardingDeps } from './onboarding-types.js'

export function completeOnboardingRun(
  db: Database,
  userId: string,
  runId: string,
  deps: Pick<OnboardingDeps, 'markUserOnboardingComplete'>,
): OnboardingRun {
  const run = findOnboardingRunById(db, runId)
  if (!run || run.userId !== userId) throw new NotFoundError('onboarding-run', runId)
  deps.markUserOnboardingComplete(db, userId)
  return run
}
