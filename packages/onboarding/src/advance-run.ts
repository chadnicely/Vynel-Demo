// `advanceRun` — the bookkeeping helper. The ONLY place `currentStepKind` /
// `completedSteps` / `collectedData` change. Merges the step input into
// collectedData (kept as opaque `Record` here — no cast needed), appends the
// completed step, computes the next step, stamps timestamps, and detects
// completion. Sync (pure DB). Spec: blueprint.md §6.2 + coding.md §1.3.

import type { Database } from '@vynel/db'
import {
  updateOnboardingRun,
  type OnboardingRun,
  type NewOnboardingRun,
} from '@vynel/db/repositories/onboarding'
import {
  getNextOnboardingStep,
  type OnboardingStepKind,
} from '@vynel/contracts/onboarding/onboarding-step-catalog'

// Maps a stepKind to its `CollectedOnboardingData` key.
const COLLECTED_KEY_BY_STEP: Record<OnboardingStepKind, string> = {
  welcome: 'welcome',
  profile: 'profile',
  'identity-seed': 'identitySeed',
  'connect-brain': 'connectBrain',
  'github-backup': 'githubBackup',
}

export function advanceRun(
  db: Database,
  run: OnboardingRun,
  justCompletedStep: OnboardingStepKind,
  stepInput: unknown,
): OnboardingRun {
  const collected: Record<string, unknown> = { ...run.collectedData }
  collected[COLLECTED_KEY_BY_STEP[justCompletedStep]] = stepInput

  const completedSteps = run.completedSteps.includes(justCompletedStep)
    ? run.completedSteps
    : [...run.completedSteps, justCompletedStep]

  const nextStep = getNextOnboardingStep(justCompletedStep)
  const status = nextStep ? 'in-progress' : 'completed'

  const patch: Partial<NewOnboardingRun> = {
    currentStepKind: nextStep ?? justCompletedStep,
    completedSteps,
    collectedData: collected,
    status,
    lastActivityAt: new Date(),
    completedAt: status === 'completed' ? new Date() : null,
  }

  return updateOnboardingRun(db, run.id, patch)
}
