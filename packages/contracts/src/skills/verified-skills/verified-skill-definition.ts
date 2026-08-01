// The Verified-skill catalog shape — what every entry in
// `VERIFIED_SKILL_CATALOG` is. Lives in `@vynel/contracts` because
// the catalog is consumed by `@vynel/skills` (installer,
// settings resolver, sync) AND `apps/web` (the panel + marketplace
// card) AND eventually `apps/mcp` (the `list_available_skills`
// tool).
//
// `isSystemInstalled: true` blocks `uninstallSkill` via the
// installer's check (no separate `UNINSTALL_BLOCKED_SKILL_IDS`
// constant). The flag lives WITH the catalog entry so a future
// system-installed bundle just sets the flag — no special-case
// constant to remember. Locked at D3.
//
// `recommendedScope` defaults the install picker; the user can
// override (D4 — two scopes: user / workspace).
//
// `requiredMcpServers: SkillRequiredMcpServer[]` is a per-catalog-
// entry *requirement spec* (what the installer writes into the
// user's `~/.claude.json` / workspace `.mcp.json`), NOT a
// read-back of an MCP server's configured state. We deliberately
// don't reuse `@vynel/providers`'s `McpServerConfig` here — that
// type carries provider-installation state (`providerId`,
// `isEnabled`) which is per-row at the provider boundary, not
// part of the catalog spec. Refined at scaffold time (Gate 1
// 2026-05-25) — the blueprint hand-waved `McpServerConfig[]`;
// the cleaner shape is below.

export type VerifiedSkillDefinition = {
  /** Kebab-case, unique within the catalog (e.g. 'email-drafter'). */
  skillId: string
  /** User-readable name (e.g. 'Email Drafter'). */
  displayName: string
  /** One-line description for the panel + marketplace card. */
  oneLineDescription: string
  category: SkillCategory
  /** Lucide-vue-next icon name. */
  iconName: string
  /** Semver — bumped when the bundled skill content changes. */
  version: string
  recommendedScope: SkillScope
  /** SKILL.md content with `{{settings.<key>}}` placeholders. */
  skillMarkdownTemplate: string
  /** Empty = no MCP servers required. */
  requiredMcpServers: SkillRequiredMcpServer[]
  /** Empty = no settings. */
  settingsSchema: SkillSettingSchema[]
  /**
   * `true` = auto-installed by onboarding + uninstall blocked by
   * `installer.uninstallSkill` (throws `ForbiddenError`). Disable
   * is still allowed.
   */
  isSystemInstalled: boolean
}

export type SkillCategory =
  | 'email'
  | 'documents'
  | 'calendar'
  | 'files'
  | 'research'
  | 'notes'
  | 'context'
  // The claude-official arc's audience categories (2026-08-01): visual/
  // design skills and writing/announcement skills respectively.
  | 'creative'
  | 'communication'

export type SkillScope = 'user' | 'workspace'

/**
 * The MCP-server requirement a Verified skill declares. Consumed
 * by the installer's `updateMcpServersForScope`, which merges
 * this entry into the user's `~/.claude.json` (or workspace's
 * `.mcp.json`) `mcpServers` field. We touch only the
 * `mcpServers` field — the user's hand-edited other keys are
 * preserved. Per blueprint §6.2 + coding.md §1.2.
 */
export type SkillRequiredMcpServer = {
  /** Unique identifier within the MCP servers map. */
  serverName: string
  transport: 'stdio' | 'http' | 'sse'
  /** For stdio: the executable command. For http/sse: the URL. */
  commandOrUrl: string
  /** For stdio: command args. For http/sse: empty. */
  args: string[]
  /** Env vars passed to the MCP server process. */
  environment: Record<string, string>
}

export type SkillSettingSchema = {
  /** Matches `{{settings.<key>}}` in the template. */
  settingKey: string
  /** Label shown in the settings drawer. */
  displayLabel: string
  /** Helper text under the label. */
  description: string
  type: 'string' | 'number' | 'boolean' | 'string-enum'
  defaultValue: string | number | boolean
  /** Required when `type === 'string-enum'`. */
  enumValues?: readonly string[]
  /** Type-specific bounds (min/max for number; minLength/maxLength for string). */
  validationConstraints?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
  }
}
