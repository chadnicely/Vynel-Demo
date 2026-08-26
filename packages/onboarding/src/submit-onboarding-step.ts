// `submitOnboardingStep` — the single dispatcher the HTTP route calls. Validates
// ownership + run status + step match, parses the per-step Zod schema, calls the
// handler, and — when the run reaches `completed` (the last step) — flips
// users.hasCompletedOnboarding via completeOnboardingRun (the gate-opening seam).

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findOnboardingRunById, type OnboardingRun } from '@vynel/db/repositories/onboarding'
import {
  WelcomeStepInputSchema,
  ProfileStepInputSchema,
  IdentitySeedStepInputSchema,
  ConnectBrainStepInputSchema,
  GitHubBackupStepInputSchema,
} from '@vynel/contracts/onboarding/onboarding-step-inputs'
import type { OnboardingStepKind } from '@vynel/contracts/onboarding/onboarding-step-catalog'
import {
  handleWelcomeStep,
  handleProfileStep,
  handleIdentitySeedStep,
  handleConnectBrainStep,
  handleGitHubBackupStep,
} from './handlers/index.js'
import { completeOnboardingRun } from './complete-onboarding-run.js'
import {
  OnboardingRunAlreadyCompletedError,
  OnboardingStepKindMismatchError,
} from './onboarding-errors.js'
import type { OnboardingDeps } from './onboarding-types.js'

export interface SubmitOnboardingStepInput {
  userId: string
  runId: string
  stepKind: OnboardingStepKind
  stepInput: unknown
}

export async function submitOnboardingStep(
  db: Database,
  input: SubmitOnboardingStepInput,
  deps: OnboardingDeps,
): Promise<OnboardingRun> {
  const run = findOnboardingRunById(db, input.runId)
  if (!run || run.userId !== input.userId) throw new NotFoundError('onboarding-run', input.runId)
  if (run.status === 'completed') throw new OnboardingRunAlreadyCompletedError(input.runId)
  if (run.status === 'abandoned') throw new NotFoundError('onboarding-run', input.runId)
  if (run.currentStepKind !== input.stepKind) {
    throw new OnboardingStepKindMismatchError(run.currentStepKind, input.stepKind)
  }

  // The whole `OnboardingDeps` bundle is passed straight through; the handlers
  // each declare the narrow Pick they need.
  let result: OnboardingRun
  switch (input.stepKind) {
    case 'welcome':
      result = handleWelcomeStep(db, run, WelcomeStepInputSchema.parse(input.stepInput))
      break
    case 'profile':
      result = handleProfileStep(db, run, ProfileStepInputSchema.parse(input.stepInput), deps)
      break
    case 'identity-seed':
      result = handleIdentitySeedStep(
        db,
        run,
        IdentitySeedStepInputSchema.parse(input.stepInput),
        deps,
      )
      break
    case 'connect-brain':
      result = handleConnectBrainStep(
        db,
        run,
        ConnectBrainStepInputSchema.parse(input.stepInput),
        deps,
      )
      break
    case 'github-backup':
      result = handleGitHubBackupStep(
        db,
        run,
        GitHubBackupStepInputSchema.parse(input.stepInput),
        deps,
      )
      break
    default: {
      const exhaustive: never = input.stepKind
      throw new Error(`unhandled onboarding step: ${String(exhaustive)}`)
    }
  }

  if (result.status === 'completed') {
    completeOnboardingRun(db, input.userId, result.id, deps)
  }
  return result
}
