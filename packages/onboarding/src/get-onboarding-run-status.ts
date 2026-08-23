// `getOnboardingRunStatus` — loads the run (404 if missing / not owned), derives
// the current step entry + completed count. `collectedData` is cast from the
// opaque DB JSON to its contract shape. A run parked on a retired step reads
// as 404 too — `startOnboardingRun` is the self-heal door (the wizard always
// starts before it polls status). Sync. Spec: blueprint.md §6.1.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findOnboardingRunById } from '@vynel/db/repositories/onboarding'
import {
  findOnboardingStepByKind,
  ONBOARDING_STEP_CATALOG,
} from '@vynel/contracts/onboarding/onboarding-step-catalog'
import type { CollectedOnboardingData } from '@vynel/contracts/onboarding/collected-onboarding-data'
import type { OnboardingRunStatusSnapshot } from './onboarding-types.js'

export function getOnboardingRunStatus(
  db: Database,
  userId: string,
  runId: string,
): OnboardingRunStatusSnapshot {
  const run = findOnboardingRunById(db, runId)
  if (!run || run.userId !== userId) throw new NotFoundError('onboarding-run', runId)

  const currentStep = findOnboardingStepByKind(run.currentStepKind)
  if (!currentStep) throw new NotFoundError('onboarding-step', run.currentStepKind)

  const collectedData = run.collectedData as unknown as CollectedOnboardingData

  return {
    run,
    currentStep,
    totalSteps: ONBOARDING_STEP_CATALOG.length,
    completedStepCount: run.completedSteps.length,
    collectedData,
  }
}
