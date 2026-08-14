// The operator's tool-policy defaults — GLOBAL product config (one row per
// tool, no account scoping): which tools ship enabled, where they attach,
// how they card, and which tier/capability gates them. Desktop releases
// bake the resolved map at build time; a change ships with the next
// version. Every column except the key is nullable — NULL means "inherit
// the declared catalog default", so a row exists only while at least one
// override does (the product `tool_policies` lineage).

import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import type { ToolCardClass } from "@vynel/contracts/tool-policy/catalog";

export const toolPolicyDefaults = pgTable("tool_policy_defaults", {
  // The full `mcp__<server>__<tool>` name — the same key every policy
  // surface uses. Validated against the contracts catalog snapshot at write.
  toolName: text().primaryKey(),

  // NULL = inherit. `false` removes the tool from every shipped surface.
  enabled: boolean(),

  // NULL = inherit the declared class ('never' | 'ask' | 'always').
  cardClass: text().$type<ToolCardClass>(),

  // NULL = inherit declared surface membership; a JSON array of
  // SessionSurfaceKind strings otherwise.
  surfacesJson: jsonb().$type<string[]>(),

  // NULL = inherit; 'none' = ungate; else a HubFeatureKey.
  featureKey: text(),

  // NULL = inherit; 'none' = ungate; else a capability id.
  capabilityId: text(),

  createdAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export type ToolPolicyDefaultRow = typeof toolPolicyDefaults.$inferSelect;
