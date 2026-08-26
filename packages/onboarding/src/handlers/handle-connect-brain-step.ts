// Step 4 (connect-brain) — "Vynel builds with your own AI account" (Chad's
// Welcome prototype, 2026-08-24).
//
// The CONNECTING already has a home: the providers routes the account popup
// uses, where the CLI owns the credential and Vynel never sees a token. This
// step therefore records only which brain the user settled on and advances —
// no secret reaches the onboarding domain, and no second sign-in path exists
// to drift from the first.
//
// Phase 1 is Claude only; the contract's literal union is what refuses
// anything else, so this handler has no provider branching to go stale.

import type { Database } from '@vynel/db'
import type { ConnectBrainStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export function handleConnectBrainStep(
  db: Database,
  run: OnboardingRun,
  input: ConnectBrainStepInput,
  deps: Pick<OnboardingDeps, 'logger'>,
): OnboardingRun {
  deps.logger?.info({ userId: run.userId, providerId: input.providerId }, 'onboarding: brain chosen')
  return advanceRun(db, run, 'connect-brain', input)
}
