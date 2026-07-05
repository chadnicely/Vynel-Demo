// Public surface of the `@vynel/onboarding` package. Consumers import per-op
// from the barrel. Per `.claude/rules/structure-standard.md` "packages/core/src/".

export type {
  OnboardingRun,
  NewOnboardingRun,
  StructuralLogger,
  OnboardingRunStatusSnapshot,
  OnboardingDeps,
  MemorySeedEntry,
  SkillInstallRequest,
  SkillSettingValues,
} from './onboarding-types.js'

export {
  OnboardingRunAlreadyCompletedError,
  OnboardingStepKindMismatchError,
  OnboardingStepOutOfOrderError,
} from './onboarding-errors.js'

// Lifecycle ops (sync).
export { startOnboardingRun } from './start-onboarding-run.js'
export { restartOnboardingRun } from './restart-onboarding-run.js'
export { getOnboardingRunStatus } from './get-onboarding-run-status.js'
export { checkIfOnboardingNeeded, type OnboardingNeededStatus } from './check-if-onboarding-needed.js'
export { completeOnboardingRun } from './complete-onboarding-run.js'
export { advanceRun, type AdvanceRunUpdates } from './advance-run.js'

// Seeding.
export {
  buildMemorySeedEntries,
  type BuildMemorySeedEntriesInput,
} from './seeding/build-memory-seed-entries.js'

// The dispatcher (the public step-submit entry point). The seven handlers are
// domain-internal (called only by the dispatcher).
export {
  submitOnboardingStep,
  type SubmitOnboardingStepInput,
} from './submit-onboarding-step.js'
