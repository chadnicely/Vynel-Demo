// The boot-primed baked layer end-to-end: a real shipped-map file changes
// what resolveSessionToolPolicies returns; a missing or mangled file leaves
// the code defaults untouched (an engine on a user's machine must never
// brick on a bad bake).

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "@vynel/testing";
import type { Database } from "@vynel/db";
import { insertUser } from "@vynel/db/repositories/users";
import {
  bakedToolPolicyDefaults,
  primeBakedToolPolicyDefaults,
  resetBakedToolPolicyDefaultsForTest,
} from "./baked-tool-policy-defaults.js";
import { resolveSessionToolPolicies } from "./session-tool-catalog.js";

const recordingLogger = () => {
  const lines: string[] = [];
  return {
    lines,
    info: (_obj: object, msg?: string) => void lines.push(`info:${msg ?? ""}`),
    warn: (_obj: object, msg?: string) => void lines.push(`warn:${msg ?? ""}`),
  };
};

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

const tempDirs: string[] = [];
function makeAssetsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vynel-baked-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetBakedToolPolicyDefaultsForTest();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("primeBakedToolPolicyDefaults", () => {
  it("a shipped map changes the effective policies for every resolve", () => {
    withTestDatabase((db) => {
      const userId = seedUser(db);
      const before = resolveSessionToolPolicies(db, { userId });
      expect(before.get("mcp__vynel__list_tasks")?.cardClass).toBe("never");

      const assetsDir = makeAssetsDir();
      writeFileSync(
        join(assetsDir, "tool-policy-defaults.json"),
        JSON.stringify({
          version: "a".repeat(64),
          generatedAt: new Date().toISOString(),
          defaults: [
            {
              toolName: "mcp__vynel__list_tasks",
              enabled: null,
              cardClass: "always",
              surfaces: null,
              featureKey: null,
              capabilityId: null,
            },
          ],
        }),
      );
      const logger = recordingLogger();
      primeBakedToolPolicyDefaults({ assetsDir, logger });
      expect(logger.lines).toContain("info:baked tool-policy map active");

      const after = resolveSessionToolPolicies(db, { userId });
      expect(after.get("mcp__vynel__list_tasks")?.cardClass).toBe("always");
    });
  });

  it("missing file: info, empty layer; mangled file: WARN, empty layer", () => {
    const missing = recordingLogger();
    primeBakedToolPolicyDefaults({
      assetsDir: makeAssetsDir(),
      logger: missing,
    });
    expect(missing.lines).toContain(
      "info:no baked tool-policy map — code defaults apply",
    );
    expect(bakedToolPolicyDefaults()).toEqual([]);

    const assetsDir = makeAssetsDir();
    writeFileSync(
      join(assetsDir, "tool-policy-defaults.json"),
      '{"not": "a map"}',
    );
    const mangled = recordingLogger();
    primeBakedToolPolicyDefaults({ assetsDir, logger: mangled });
    expect(mangled.lines).toContain(
      "warn:baked tool-policy map invalid — code defaults apply",
    );
    expect(bakedToolPolicyDefaults()).toEqual([]);
  });
});
