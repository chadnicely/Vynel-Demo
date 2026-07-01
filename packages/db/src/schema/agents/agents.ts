// The `agents` table — one row per Vynel agent (a named, reusable
// "hand" the root brain invokes). An agent = the SDK `AgentDefinition`
// (`@anthropic-ai/claude-agent-sdk`) + Vynel metadata. The DB row is
// the source of truth; it is materialized to the SDK shape at session
// start by `resolveEnabledAgentsForSession` (the skills-domain
// pattern — DB row is canonical; provider-disk materialization is a
// later unit). Spec: `docs/agent-base/agents.md` "The model" +
// "Schema (proposed)".
//
// `userId` is the tenant boundary (FK → users.id, cascade); every row
// carries it even though Phase 1 has one user, so Phase 2 multi-user
// is a data-only migration. Per data-standard.md "Ownership /
// identity" + foundation §2 row 9 + §11 #14.
//
// `workspaceId` is a NULLABLE FK with `onDelete: 'cascade'` — null =
// user-scope (the agent is available in every workspace the user
// owns); non-null = workspace-scope (only that workspace). Uses
// `text().references(...)` rather than `id()` because `id()` is NOT
// NULL by dialect contract; nullable FKs use `text().references(...)`
// per the precedent in `skills/installed-skills.ts:54`.
//
// `deletedAt` is the soft-delete column (data-standard "Soft delete").
// Default retention window: 30 days; the hard-delete primitive is the
// repo's `hardDeleteAgentsDeletedBefore`. (The purge WORKER job — the
// scheduled caller — is a follow-up unit, not built here.)
//
// The string-union types below MIRROR the SDK `AgentDefinition`'s
// allowed values (effort/permissionMode) and the marketplace
// `PublisherTier` vocabulary (trustTier) — DUPLICATED here rather than
// imported, because `packages/db` is a leaf package with no path to
// `@vynel/contracts` or the SDK, and schema files must stay
// dialect-only. This is the same convention as `SkillScope`
// (duplicated in `schema/skills/installed-skills.ts` +
// `contracts/.../verified-skill-definition.ts`).

import { sql } from 'drizzle-orm'
import { table, id, text, timestamp, boolean, json, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from '../workspaces/workspaces.js'

export type AgentScope = 'user' | 'workspace'

// Provenance — LOCKED by `.claude/ceo/agent-base/build-brief-agents.md`
// §3 (`source ∈ vynel|user|community`). `vynel` = Vynel-curated seed;
// `user` = built in the in-app agent builder (a later unit);
// `community` = installed from the marketplace (a later unit).
export type AgentSource = 'vynel' | 'user' | 'community'

// Distribution-trust tier — mirrors `PublisherTier`
// (`@vynel/contracts/marketplace/marketplace-item`). Phase 1 emits
// only `verified` (Vynel-curated seed) + `community` (user-built /
// marketplace, lowest trust until the builder's tool-grant safety
// validation ships — see `orchestration.md` Open #2);
// `anthropic-official` is reserved (same as marketplace).
export type AgentTrustTier = 'verified' | 'anthropic-official' | 'community'

// Reasoning effort — the named levels of the SDK
// `AgentDefinition.effort` union (the SDK also accepts a raw integer;
// the column stores the named levels only — widen if a numeric effort
// is ever needed). `null` = inherit the main model's effort.
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Permission mode — mirrors the SDK `PermissionMode` union. `null` =
// inherit. Seeds use `default` (or null) — never `bypassPermissions`/
// `dontAsk`/`auto`, which would model the unsafe approval-card-skip
// pattern the builder unit must guard against.
export type AgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export const agents = table(
  'agents',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),

    // Kebab-case, the `@mention` handle + the key in the resolved
    // `Record<string, AgentDefinition>` passed to `query({ agents })`.
    slug: text().notNull(),
    name: text().notNull(),

    // → AgentDefinition.description (natural-language "when to use
    // this agent"). Required by the SDK.
    description: text().notNull(),
    // Lucide-vue-next icon name for the Agents panel; nullable.
    icon: text(),
    // → AgentDefinition.prompt (the system prompt). Required.
    prompt: text().notNull(),

    // → AgentDefinition.model. null = inherit the main session model.
    model: text(),
    // → AgentDefinition.effort. null = inherit.
    effort: text().$type<AgentEffort>(),
    // → AgentDefinition.permissionMode. null = inherit.
    permissionMode: text().$type<AgentPermissionMode>(),
    // → AgentDefinition.background (fire-and-forget when invoked).
    background: boolean().notNull(),

    // → AgentDefinition.tools / .disallowedTools. Opaque arrays matched
    // at compose time, never filtered → `json<string[]>()` per
    // data-standard "Schema". null `allowedTools` = inherit all tools.
    // MCP tool access resolves through `capabilities`, NOT duplicated
    // here.
    allowedTools: json<string[]>(),
    disallowedTools: json<string[]>(),

    scope: text().$type<AgentScope>().notNull(),
    source: text().$type<AgentSource>().notNull(),
    trustTier: text().$type<AgentTrustTier>().notNull(),

    // Per-row enable flag — `resolveEnabledAgentsForSession` returns
    // only enabled (and non-deleted) agents.
    enabled: boolean().notNull(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => ({
    byUser: index('idx_agents_user').on(t.userId),
    byWorkspace: index('idx_agents_workspace').on(t.workspaceId),
    byDeletedAt: index('idx_agents_deleted_at').on(t.deletedAt),

    // Cross-scope coexistence: the 3-column unique index permits a
    // user-scope row (workspaceId NULL) + a workspace-scope row
    // (workspaceId non-null) for the same (userId, slug). Partial on
    // `deleted_at IS NULL` so a soft-deleted agent's slug can be
    // re-used. Same NULL-distinct + soft-delete-aware shape as
    // `installed_skills` (D9 corrective). Works identically in
    // Postgres Phase 2.
    uniqueUserWorkspaceSlug: uniqueIndex('uniq_agents_user_workspace_slug')
      .on(t.userId, t.workspaceId, t.slug)
      .where(sql`${t.deletedAt} IS NULL`),

    // User-scope dedup: standard SQL treats two NULLs as DISTINCT in a
    // unique index, so the 3-col index above does NOT catch two
    // user-scope rows with the same (userId, slug). A PARTIAL unique
    // index covering only the live user-scope subset closes the gap
    // (the `installed_skills` D9 precedent).
    uniqueUserScopeSlug: uniqueIndex('uniq_agents_user_scope_slug')
      .on(t.userId, t.slug)
      .where(sql`${t.workspaceId} IS NULL AND ${t.deletedAt} IS NULL`),
  }),
)

export type AgentRow = typeof agents.$inferSelect
export type NewAgentRow = typeof agents.$inferInsert
