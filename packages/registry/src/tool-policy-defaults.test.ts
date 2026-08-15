// The operator defaults core over PGlite: full-replace save, all-null =
// reset, semantic validation against the contracts catalog snapshot, and
// the map export's content-hash version (identical maps hash identically —
// the property the desktop release bake keys on).

import { describe, it, expect } from "vitest";
import { withTestCloudDatabase } from "@vynel/cloud-db/testing";
import { NotFoundError, ValidationError } from "@vynel/errors";
import {
  listToolPolicyDefaults,
  resolveToolPolicyMapExport,
  setToolPolicyDefault,
} from "./tool-policy-defaults.js";
import { upsertToolPolicyDefaultRow } from "./repositories/tool-policy-defaults-repository.js";

const INHERIT_ALL = {
  enabled: null,
  cardClass: null,
  surfaces: null,
  featureKey: null,
  capabilityId: null,
} as const;

describe("setToolPolicyDefault + listToolPolicyDefaults", () => {
  it("saves a partial override and lists it back (nulls = inherit)", async () => {
    await withTestCloudDatabase(async (db) => {
      const saved = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        enabled: false,
      });
      expect(saved).toEqual({
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        enabled: false,
      });
      expect(await listToolPolicyDefaults(db)).toEqual([saved]);
    });
  });

  it("an all-null save normalizes to a DELETE and returns null", async () => {
    await withTestCloudDatabase(async (db) => {
      await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        cardClass: "always",
      });
      const reset = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
      });
      expect(reset).toBeNull();
      expect(await listToolPolicyDefaults(db)).toEqual([]);
    });
  });

  it("rejects a tool the catalog snapshot does not declare", async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        setToolPolicyDefault(db, {
          ...INHERIT_ALL,
          toolName: "mcp__vynel__made_up_tool",
          enabled: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("rejects unknown gate vocabulary; accepts declared keys and 'none'", async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        setToolPolicyDefault(db, {
          ...INHERIT_ALL,
          toolName: "mcp__vynel__list_tasks",
          featureKey: "not-a-feature",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        setToolPolicyDefault(db, {
          ...INHERIT_ALL,
          toolName: "mcp__vynel__list_tasks",
          capabilityId: "not-a-capability",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      const saved = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel-ssh__run_ssh_command",
        featureKey: "none",
        capabilityId: "none",
      });
      expect(saved?.featureKey).toBe("none");
    });
  });

  it("a STALE row (tool no longer in the snapshot) stays resettable", async () => {
    await withTestCloudDatabase(async (db) => {
      // Simulate a catalog shrink: the row exists but its tool does not —
      // only possible via the repo, the op refuses to create it.
      await upsertToolPolicyDefaultRow(db, {
        toolName: "mcp__vynel__retired_tool",
        enabled: false,
        cardClass: null,
        surfacesJson: null,
        featureKey: null,
        capabilityId: null,
      });
      const reset = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__retired_tool",
      });
      expect(reset).toBeNull();
      expect(await listToolPolicyDefaults(db)).toEqual([]);
    });
  });

  it("canonicalizes surfaces: declared order, deduped — reorder never flips the version", async () => {
    await withTestCloudDatabase(async (db) => {
      const first = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        surfaces: ["schedule", "agent", "schedule"],
      });
      expect(first?.surfaces).toEqual(["agent", "schedule"]);
      const version = (await resolveToolPolicyMapExport(db)).version;

      const resent = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        surfaces: ["agent", "schedule"],
      });
      expect(resent?.surfaces).toEqual(["agent", "schedule"]);
      expect((await resolveToolPolicyMapExport(db)).version).toBe(version);
    });
  });

  it("full-replace: a second save drops fields the first had set", async () => {
    await withTestCloudDatabase(async (db) => {
      await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        enabled: false,
        cardClass: "always",
      });
      const replaced = await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        surfaces: ["workspace-interactive"],
      });
      expect(replaced).toEqual({
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        surfaces: ["workspace-interactive"],
      });
    });
  });
});

describe("resolveToolPolicyMapExport", () => {
  it("hashes the canonical defaults — identical maps carry identical versions", async () => {
    await withTestCloudDatabase(async (db) => {
      const empty = await resolveToolPolicyMapExport(db);
      expect(empty.defaults).toEqual([]);
      expect(empty.version).toMatch(/^[0-9a-f]{64}$/);

      await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        enabled: false,
      });
      const one = await resolveToolPolicyMapExport(db);
      expect(one.version).not.toBe(empty.version);

      // Delete + re-save the same content → the version returns exactly.
      await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
      });
      await setToolPolicyDefault(db, {
        ...INHERIT_ALL,
        toolName: "mcp__vynel__list_tasks",
        enabled: false,
      });
      const again = await resolveToolPolicyMapExport(db);
      expect(again.version).toBe(one.version);
      expect((await resolveToolPolicyMapExport(db)).defaults).toHaveLength(1);
    });
  });
});
