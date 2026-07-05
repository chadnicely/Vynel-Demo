// Step 1 (welcome) handler — a no-op that acknowledges and advances. Sync.
// Spec: blueprint.md §6.4.

import type { Database } from '@vynel/db'
import type { WelcomeStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import type { OnboardingRun } from '../onboarding-types.js'

export function handleWelcomeStep(
  db: Database,
  run: OnboardingRun,
  input: WelcomeStepInput,
): OnboardingRun {
  return advanceRun(db, run, 'welcome', input)
}
