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
  SKILL_UPDATED,
  SKILL_SETTINGS_UPDATED,
} from './skills-events.js'

export type {
  SkillInstalledPayload,
  SkillUninstalledPayload,
  SkillUpdatedPayload,
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
export { updateCloudSkill, type UpdateCloudSkillInput } from './lifecycle/update-cloud-skill.js'
export { uninstallSkill, type UninstallSkillInput } from './lifecycle/uninstall-skill.js'
export { updateSkillSettings, type UpdateSkillSettingsInput } from './settings/update-skill-settings.js'
export {
  synchronizeSkillsWithProvider,
  type SynchronizeSkillsWithProviderInput,
  type SynchronizeSkillsResult,
} from './lifecycle/synchronize-skills-with-provider.js'
// Standalone MCP-server config ops (marketplace `mcp` kind, config-is-truth) —
// exported from THIS leaf because it is the only writer of the Claude MCP
// config files (coding.md §1.2).
export {
  installMcpServerForScope,
  type InstallMcpServerForScopeInput,
} from './mcp-servers/install-mcp-server-for-scope.js'
export {
  removeMcpServerForScope,
  type RemoveMcpServerForScopeInput,
} from './mcp-servers/remove-mcp-server-for-scope.js'
export {
  listMcpServerEntriesForScope,
  type McpServerEntryView,
} from './mcp-servers/list-mcp-server-entries-for-scope.js'
export { type McpServerProvenance } from './internal/mcp-server-provenance.js'
export { approveProjectMcpjsonServer } from './internal/update-project-mcp-approval.js'
export {
  listMcpServersForScope,
  type ConfiguredMcpServer,
} from './mcp-servers/list-mcp-servers-for-scope.js'
export {
  addCustomMcpServerForScope,
  type AddCustomMcpServerForScopeInput,
} from './mcp-servers/add-custom-mcp-server-for-scope.js'
// Marketplace rule-file ops (marketplace `rule` kind, config-is-truth) —
// same single-writer rationale; the provenance marker keeps the user's own
// `.claude/rules/*.md` files untouchable.
export {
  installRuleFileForScope,
  type InstallRuleFileForScopeInput,
} from './rules/install-rule-file-for-scope.js'
export {
  removeRuleFileForScope,
  type RemoveRuleFileForScopeInput,
} from './rules/remove-rule-file-for-scope.js'
export {
  listInstalledRulesForScope,
  type InstalledRuleFile,
} from './rules/list-installed-rules-for-scope.js'
// The Rules view's UNFILTERED folder read — every `.md`, hand-written
// included, each carrying its marketplace provenance (or null).
export {
  listAllRuleFilesForScope,
  type RuleFileForScope,
} from './rules/list-all-rule-files-for-scope.js'
// The Commands view's folder read (`.claude/commands/`) — also the "/" menu's
// planned data source.
export {
  listCommandsForScope,
  type CommandFileForScope,
} from './commands/list-commands-for-scope.js'
