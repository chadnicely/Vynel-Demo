// The `tool_policies` table — the admin's per-tool OVERRIDES over the declared
// defaults (descriptor maps + the generated registry). One row per
// (user, toolName); EVERY policy column is nullable, and NULL means "inherit
// the declared default" — a row exists only while at least one override does,
// so the declared world stays the single source of truth and the table stays
// small. Deleting a row IS "reset to default" (no deletedAt — the
// workspace_capabilities lineage).
//
// USER-scoped, not workspace-scoped: the tool surface is machine-level policy
// (which tools exist / card / attach where), while per-workspace variation
// stays with `workspace_capabilities`. `userId` is the Phase-2 tenant
// boundary as everywhere.

import { table, id, text, timestamp, boolean, json, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'

/** How a tool's calls gate: never card / card in ask+plan-only / card in
 *  every carding mode. Mirrors `tool-approval-policy.ts`'s tiers. */
export type ToolCardClass = 'never' | 'ask' | 'always'

export const toolPolicies = table(
  'tool_policies',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),

    // The full `mcp__<server>__<tool>` name — the same key every policy
    // surface uses (deny patterns, card sets, the catalog).
    toolName: text().notNull(),

    // NULL = inherit. `false` removes the tool from every surface.
    enabled: boolean(),

    // NULL = inherit the declared class (curated ask-tier / never).
    cardClass: text().$type<ToolCardClass>(),

    // NULL = inherit the declared surface membership. A JSON array of
    // SessionSurfaceKind strings — the surfaces this tool may attach to.
    surfacesJson: json<string[]>(),

    // NULL = inherit; 'none' = ungate (a pro tool made free); else a
    // HubFeatureKey. Open text like capabilityId below — the route validates.
    featureKey: text(),

    // NULL = inherit; 'none' = ungate; else a capability id.
    capabilityId: text(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    byUser: index('idx_tool_policies_user').on(t.userId),
    // One override row per (user, tool).
    uniqueUserTool: uniqueIndex('uniq_tool_policies_user_tool').on(t.userId, t.toolName),
  }),
)

export type ToolPolicyRow = typeof toolPolicies.$inferSelect
export type NewToolPolicyRow = typeof toolPolicies.$inferInsert
