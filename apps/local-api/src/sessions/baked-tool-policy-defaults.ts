// The BAKED operator tool-policy map — loaded once at boot from the shipped
// assets dir (`tool-policy-defaults.json`, written by the release build's
// hub download; see scripts/src/release/build-payload.ts). Module-level so
// `resolveSessionToolPolicies` picks it up with ZERO call-site threading
// across the nine turn sites. Dev runs and tests never prime it — the code
// catalog stays the whole story, exactly as before the layer existed.
//
// A missing file is normal (dev build); an invalid one is a build defect —
// but the engine belongs to a non-technical user, so it WARNS and falls
// back to code defaults rather than refusing to boot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolPolicyDefault } from "@vynel/contracts/tool-policy/defaults";
import { ToolPolicyMapExportSchema } from "@vynel/contracts/tool-policy/defaults";

const BAKED_MAP_FILENAME = "tool-policy-defaults.json";

type StructuralLogger = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
};

let bakedDefaults: readonly ToolPolicyDefault[] = [];

export function primeBakedToolPolicyDefaults(input: {
  assetsDir: string;
  logger: StructuralLogger;
}): void {
  const filePath = join(input.assetsDir, BAKED_MAP_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    input.logger.info(
      { filePath },
      "no baked tool-policy map — code defaults apply",
    );
    return;
  }
  try {
    const map = ToolPolicyMapExportSchema.parse(JSON.parse(raw));
    bakedDefaults = map.defaults;
    input.logger.info(
      { version: map.version, defaults: map.defaults.length },
      "baked tool-policy map active",
    );
  } catch (err) {
    input.logger.warn(
      { err, filePath },
      "baked tool-policy map invalid — code defaults apply",
    );
  }
}

export function bakedToolPolicyDefaults(): readonly ToolPolicyDefault[] {
  return bakedDefaults;
}

export function resetBakedToolPolicyDefaultsForTest(): void {
  bakedDefaults = [];
}
