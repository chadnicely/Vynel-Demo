// Public surface of the `@vynel/onboarding` package. Consumers import per-op
// from the barrel. Per `.claude/rules/structure-standard.md` "packages/core/src/".

export type {
  OnboardingRun,
  NewOnboardingRun,
  StructuralLogger,
  OnboardingRunStatusSnapshot,
  OnboardingDeps,
} from './onboarding-types.js'

export {
  OnboardingRunAlreadyCompletedError,
  OnboardingStepKindMismatchError,
} from './onboarding-errors.js'

// Lifecycle ops (sync).
export { startOnboardingRun } from './start-onboarding-run.js'
export { restartOnboardingRun } from './restart-onboarding-run.js'
export { getOnboardingRunStatus } from './get-onboarding-run-status.js'
export { checkIfOnboardingNeeded, type OnboardingNeededStatus } from './check-if-onboarding-needed.js'
export { completeOnboardingRun } from './complete-onboarding-run.js'
export { advanceRun } from './advance-run.js'

// The dispatcher (the public step-submit entry point). The two handlers are
// domain-internal (called only by the dispatcher).
export {
  submitOnboardingStep,
  type SubmitOnboardingStepInput,
} from './submit-onboarding-step.js'
