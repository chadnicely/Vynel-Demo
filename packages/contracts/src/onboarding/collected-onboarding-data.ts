// The typed view of `onboarding_runs.collectedData` — every step's input keyed
// by its collected-data key (see the onboarding package's `advanceRun`). The
// DB stores it opaquely; the core and the web read it through this shape.

import type {
  WelcomeStepInput,
  ProfileStepInput,
  IdentitySeedStepInput,
  ConnectBrainStepInput,
  GitHubBackupStepInput,
} from './onboarding-step-inputs.js'

export interface CollectedOnboardingData {
  welcome?: WelcomeStepInput
  profile?: ProfileStepInput
  identitySeed?: IdentitySeedStepInput
  connectBrain?: ConnectBrainStepInput
  githubBackup?: GitHubBackupStepInput
}
