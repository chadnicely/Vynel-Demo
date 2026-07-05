// Barrel for the seven step handlers (domain-internal — the dispatcher is the
// public entry point). Per `.claude/rules/structure-standard.md`.

export { handleWelcomeStep } from './handle-welcome-step.js'
export { handleProfileStep } from './handle-profile-step.js'
export { handleNameWorkspaceStep } from './handle-name-workspace-step.js'
export { handleIdentitySeedStep } from './handle-identity-seed-step.js'
export { handleInstallSuggestedSkillsStep } from './handle-install-suggested-skills-step.js'
export { handleOptionalChannelStep } from './handle-optional-channel-step.js'
export { handleOptionalScheduleStep } from './handle-optional-schedule-step.js'
