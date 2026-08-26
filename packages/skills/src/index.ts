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
export {
  getInstalledSkillByScopeOrThrow,
  type GetInstalledSkillByScopeInput,
} from './queries/get-installed-skill-by-scope.js'
// The ONE disk-synced shelf read (menus, counts, CLI): reconcile, then list.
export {
  listInstalledSkillsSynced,
  type ListInstalledSkillsSyncedInput,
} from './queries/list-installed-skills-synced.js'
// The user's OWN skills — written in Vynel's editor or by Claude
// (`create_skill`); supporting files ride the skill-files doors below.
export {
  createOwnSkill,
  SAFE_SKILL_ID,
  MAX_SKILL_ID_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_BODY_LENGTH,
  type CreateOwnSkillInput,
} from './lifecycle/create-own-skill.js'
export {
  listSkillFiles,
  MAX_SKILL_TEXT_FILE_BYTES,
  type SkillFileEntry,
} from './skill-files/list-skill-files.js'
export { readSkillFile } from './skill-files/read-skill-file.js'
export { writeSkillFile, type WriteSkillFileInput } from './skill-files/write-skill-file.js'
export { deleteSkillFile } from './skill-files/delete-skill-file.js'
export {
  SKILL_ENTRY_FILE,
  MAX_SKILL_FILE_PATH_LENGTH,
} from './skill-files/assert-safe-skill-file-path.js'
export { parseSkillMarkdownFrontmatter } from './skill-files/skill-markdown-frontmatter.js'
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
  countAllRuleFilesForScope,
  readRuleFileForScope,
  type RuleFileForScope,
} from './rules/list-all-rule-files-for-scope.js'
// The user's OWN rule files — the create/edit/delete doors behind the Rules
// view and the `write_rule` / `delete_rule` tools. Never stamp a marker;
// saving over a marketplace rule forks it.
export {
  writeOwnRuleFileForScope,
  MAX_RULE_FILE_LENGTH,
  type WriteOwnRuleFileForScopeInput,
} from './rules/write-own-rule-file-for-scope.js'
export {
  deleteOwnRuleFileForScope,
  type DeleteOwnRuleFileForScopeInput,
} from './rules/delete-own-rule-file-for-scope.js'
export { isSafeRuleId, MAX_RULE_ID_LENGTH } from './rules/resolve-rules-root.js'
// The Commands view's folder read (`.claude/commands/`) — also the "/" menu's
// planned data source.
export {
  listCommandsForScope,
  countCommandsForScope,
  readCommandFileForScope,
  type CommandFileForScope,
} from './commands/list-commands-for-scope.js'
// The user's OWN slash commands — the create/edit/delete doors behind the
// Commands view and the `write_command` / `delete_command` tools.
export {
  writeOwnCommandFileForScope,
  MAX_COMMAND_BODY_LENGTH,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  MAX_COMMAND_ARGUMENT_HINT_LENGTH,
  type WriteOwnCommandFileForScopeInput,
} from './commands/write-own-command-file-for-scope.js'
export {
  deleteOwnCommandFileForScope,
  type DeleteOwnCommandFileForScopeInput,
} from './commands/delete-own-command-file-for-scope.js'
export { isSafeCommandName, MAX_COMMAND_NAME_LENGTH } from './commands/resolve-commands-root.js'
