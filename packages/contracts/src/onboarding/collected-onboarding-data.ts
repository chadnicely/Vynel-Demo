// The cumulative per-step input accumulated in `onboarding_runs.collectedData`
// (a `json<T>()` column). Each step's parsed input is stored under its key as
// the run advances; `workspacePath` + `channelId` are captured ids the later
// steps need without re-fetching a sibling domain.

import type {
  WelcomeStepInput,
  ProfileStepInput,
  NameWorkspaceStepInput,
  IdentitySeedStepInput,
  InstallSuggestedSkillsStepInput,
  OptionalChannelStepInput,
  OptionalScheduleStepInput,
} from './onboarding-step-inputs.js'

export interface CollectedOnboardingData {
  welcome?: WelcomeStepInput
  profile?: ProfileStepInput
  nameWorkspace?: NameWorkspaceStepInput
  identitySeed?: IdentitySeedStepInput
  installSuggestedSkills?: InstallSuggestedSkillsStepInput
  optionalChannel?: OptionalChannelStepInput
  optionalSchedule?: OptionalScheduleStepInput
  workspacePath?: string // captured from createWorkspace at step 3 (name-workspace)
  channelId?: string // captured if a channel connected at step 6 (optional-channel)
}
