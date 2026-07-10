// Public surface of `@vynel/skills` — the skills leaf. Re-exports the
// locked domain types + outbox event constants, then the core operations
// (queries · lifecycle · settings). Schema + repositories are internal
// (imported relatively); consumers reach the package only through this
// barrel.

export type {
  StructuralLogger,
  InstalledSkillRow,
  NewInstalledSkillRow,
  SkillScope,
  InstalledFromSource,
  InstallHealth,
  SkillSettingRow,
  NewSkillSettingRow,
  ResolvedSkillSettings,
} from './skills-types.js'

export {
  SKILL_INSTALLED,
  SKILL_UNINSTALLED,
  SKILL_ENABLED_CHANGED,
  SKILL_SETTINGS_UPDATED,
} from './skills-events.js'

export type {
  SkillInstalledPayload,
  SkillUninstalledPayload,
  SkillEnabledChangedPayload,
  SkillSettingsUpdatedPayload,
} from './skills-events.js'

export { listAvailableSkills } from './queries/list-available-skills.js'
export {
  listInstalledSkillsForContext,
  type ListInstalledSkillsForContextInput,
  type InstalledSkillWithDefinitionAndSettings,
} from './queries/list-installed-skills-for-context.js'
// Published cross-domain read surface — the RAW installed-skill rows (marketplace
// install-status annotation reads this instead of the skills repo directly).
export {
  listInstalledSkillsForUserAndWorkspace,
  type ListInstalledSkillsForUserAndWorkspaceInput,
} from './queries/list-installed-skills-for-user-and-workspace.js'
export { installSkill, type InstallSkillInput } from './lifecycle/install-skill.js'
export { installCloudSkill, type InstallCloudSkillInput } from './lifecycle/install-cloud-skill.js'
export { uninstallSkill, type UninstallSkillInput } from './lifecycle/uninstall-skill.js'
export { enableSkill, type EnableSkillInput } from './lifecycle/enable-skill.js'
export { disableSkill, type DisableSkillInput } from './lifecycle/disable-skill.js'
export { updateSkillSettings, type UpdateSkillSettingsInput } from './settings/update-skill-settings.js'
export {
  synchronizeSkillsWithProvider,
  type SynchronizeSkillsWithProviderInput,
  type SynchronizeSkillsResult,
} from './lifecycle/synchronize-skills-with-provider.js'
