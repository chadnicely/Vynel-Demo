// The cumulative per-step input accumulated in `onboarding_runs.collectedData`
// (a `json<T>()` column). Each step's parsed input is stored under its key as
// the run advances. Rows from the retired seven-step flow may carry legacy
// keys (nameWorkspace, identitySeed, …) — they are opaque history; the type
// describes what the live flow writes.

import type { WelcomeStepInput, ProfileStepInput } from './onboarding-step-inputs.js'

export interface CollectedOnboardingData {
  welcome?: WelcomeStepInput
  profile?: ProfileStepInput
}
