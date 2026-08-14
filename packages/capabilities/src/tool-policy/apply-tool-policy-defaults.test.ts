// The baked-layer transform: inherit-through nulls, 'none' ungates, unknown
// tools inert, and defaultEnabled flows into the effective resolve UNDER a
// user override (the layering contract: code → baked → user).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "@vynel/testing";
import type { Database } from "@vynel/db";
import { insertUser } from "@vynel/db/repositories/users";
import { applyToolPolicyDefaultsToCatalog } from "./apply-tool-policy-defaults.js";
import { resolveEffectiveToolPolicies } from "./resolve-effective-tool-policies.js";
import { setToolPolicyOverride } from "./set-tool-policy-override.js";
import type { ToolCatalogEntry } from "./tool-policy-types.js";

function seedUser(db: Database): string {
  const now = new Date();
  return insertUser(db, {
    id: randomUUID(),
    displayName: "T",
    emailAddress: null,
    locale: "en-US",
    timezone: "UTC",
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id;
}

const CATALOG: readonly ToolCatalogEntry[] = [
  {
    toolName: "mcp__vynel__list_tasks",
    serverName: "vynel",
    surfaces: ["workspace-interactive", "schedule"],
    cardClass: "never",
    capabilityId: "tasks",
  },
  {
    toolName: "mcp__vynel-ssh__run_ssh_command",
    serverName: "vynel-ssh",
    surfaces: ["workspace-interactive"],
    cardClass: "ask",
    featureKey: "ssh",
  },
];

const INHERIT_ALL = {
  enabled: null,
  cardClass: null,
  surfaces: null,
  featureKey: null,
  capabilityId: null,
} as const;

describe("applyToolPolicyDefaultsToCatalog", () => {
  it("overlays only the named fields; null inherits; unknown tools are inert", () => {
    const layered = applyToolPolicyDefaultsToCatalog(CATALOG, [
      {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        cardClass: "always",
        surfaces: ["agent"],
      },
      { ...INHERIT_ALL, toolName: "mcp__vynel__gone_tool", enabled: false },
    ]);
    expect(layered[0]).toEqual({
      toolName: "mcp__vynel__list_tasks",
      serverName: "vynel",
      surfaces: ["agent"],
      cardClass: "always",
      capabilityId: "tasks",
    });
    // Untouched entry passes through by reference-equality of content.
    expect(layered[1]).toEqual(CATALOG[1]);
  });

  it("'none' ungates; enabled:false lands as defaultEnabled", () => {
    const layered = applyToolPolicyDefaultsToCatalog(CATALOG, [
      {
        ...INHERIT_ALL,
        toolName: "mcp__vynel-ssh__run_ssh_command",
        featureKey: "none",
        enabled: false,
      },
    ]);
    expect(layered[1]).toEqual({
      toolName: "mcp__vynel-ssh__run_ssh_command",
      serverName: "vynel-ssh",
      surfaces: ["workspace-interactive"],
      cardClass: "ask",
      defaultEnabled: false,
    });
  });

  it("layering: a baked disable ships disabled, and the USER override still wins", () => {
    withTestDatabase((db) => {
      const userId = seedUser(db);
      const layered = applyToolPolicyDefaultsToCatalog(CATALOG, [
        { ...INHERIT_ALL, toolName: "mcp__vynel__list_tasks", enabled: false },
      ]);

      const shipped = resolveEffectiveToolPolicies(db, {
        userId,
        catalog: layered,
      });
      expect(shipped.get("mcp__vynel__list_tasks")?.enabled).toBe(false);

      setToolPolicyOverride(db, {
        userId,
        toolName: "mcp__vynel__list_tasks",
        enabled: true,
        cardClass: null,
        surfaces: null,
        featureKey: null,
        capabilityId: null,
      });
      const reEnabled = resolveEffectiveToolPolicies(db, {
        userId,
        catalog: layered,
      });
      expect(reEnabled.get("mcp__vynel__list_tasks")?.enabled).toBe(true);
    });
  });
});
