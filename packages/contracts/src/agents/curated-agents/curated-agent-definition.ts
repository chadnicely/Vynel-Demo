// The curated-agent catalog shape — what every entry in
// `CURATED_AGENT_CATALOG` is. Lives in `@vynel/contracts` because the
// catalog is consumed by `@vynel/agents` (the `installCuratedAgent`
// seed-install path) AND eventually `apps/web` (the Agents panel's
// "available curated agents" list). Mirrors the verified-skill catalog
// pattern (`@vynel/contracts/skills/verified-skills/`).
//
// A curated agent = the SDK `AgentDefinition` runtime fields (prompt,
// tools, skills, model, …) + the Vynel identity metadata (slug, name,
// icon, scope) needed to seed an `agents` row. `installCuratedAgent`
// stamps `source: 'vynel'` + `trustTier: 'verified'` + `enabled: true`
// — those are NOT part of the catalog entry (they describe the
// installed row, not the definition).
//
// The string-union types below MIRROR the SDK `AgentDefinition`'s
// allowed values + `SkillScope` — DUPLICATED here (not imported)
// because `@vynel/contracts` is a leaf with only `zod` and no path to
// the SDK or `@vynel/db`. Same convention as `SkillScope` being
// duplicated in the db schema + the verified-skill definition.

export type CuratedAgentScope = 'user' | 'workspace'

export type CuratedAgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type CuratedAgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export type CuratedAgentDefinition = {
  /** Kebab-case, unique within the catalog; the `@mention` handle. */
  slug: string
  /** User-readable name (e.g. 'Document Generator'). */
  name: string
  /** Natural-language "when to use this agent" → AgentDefinition.description. */
  description: string
  /** Lucide-vue-next icon name for the Agents panel. */
  iconName: string
  /** The agent's system prompt → AgentDefinition.prompt. */
  prompt: string
  /**
   * Model alias ('opus' | 'sonnet' | 'haiku' | 'fable') or full id;
   * omit to inherit the main session model → AgentDefinition.model.
   */
  model?: string
  /** Reasoning effort; omit to inherit → AgentDefinition.effort. */
  effort?: CuratedAgentEffort
  /**
   * Permission mode; omit to inherit. Curated seeds use `default` or
   * omit — never `bypassPermissions`/`dontAsk`/`auto` (those would model
   * the approval-card-skip pattern the builder unit must guard against).
   */
  permissionMode?: CuratedAgentPermissionMode
  /** Run as a background (fire-and-forget) agent when invoked. */
  background: boolean
  /**
   * Allowed tool patterns → AgentDefinition.tools. Omit = inherit every
   * tool from the parent session (keep curated allowlists tight).
   */
  allowedTools?: readonly string[]
  /** Denied tool patterns → AgentDefinition.disallowedTools. */
  disallowedTools?: readonly string[]
  /**
   * Preloaded Vynel skill ids → AgentDefinition.skills + `agent_skills`
   * rows. Each id is a catalog skill id (e.g. 'email-drafter'). Empty =
   * no preloaded skills.
   */
  skillIds: readonly string[]
  /** Default install scope for the picker (the user can override). */
  recommendedScope: CuratedAgentScope
}
