// Bake the operator tool-policy map (docs/module-notes/tool-policy.md): the
// engine loads assets/tool-policy-defaults.json at boot as the middle policy
// layer. Hub configured (VYNEL_HUB_URL + CLOUD_ADMIN_TOKEN) → download or
// FAIL the build (a silent skip would ship a stale/absent map); neither set →
// dev build, the engine falls back to code defaults. NOTE for the release
// env: a hub-configured desktop build (VYNEL_HUB_URL set for the public-key
// pin) now REQUIRES CLOUD_ADMIN_TOKEN alongside it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolPolicyMapExportSchema } from "@vynel/contracts/tool-policy/defaults";

export async function stageToolPolicyMap(backendDir: string): Promise<void> {
  const hubUrl = process.env["VYNEL_HUB_URL"]?.replace(/\/+$/, "");
  const adminToken = process.env["CLOUD_ADMIN_TOKEN"];
  if (hubUrl === undefined && adminToken === undefined) {
    console.log(
      "[payload] no VYNEL_HUB_URL/CLOUD_ADMIN_TOKEN — skipping tool-policy map bake",
    );
    return;
  }
  if (hubUrl === undefined || adminToken === undefined) {
    throw new Error(
      "Tool-policy map bake misconfigured: set BOTH VYNEL_HUB_URL and CLOUD_ADMIN_TOKEN, or neither.",
    );
  }
  const response = await fetch(`${hubUrl}/admin/tool-policy/map`, {
    headers: { authorization: `Bearer ${adminToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Tool-policy map download failed: ${response.status} from ${hubUrl}.`,
    );
  }
  const map = ToolPolicyMapExportSchema.parse(await response.json());
  writeFileSync(
    join(backendDir, "assets", "tool-policy-defaults.json"),
    JSON.stringify(map, null, 2),
  );
  console.log(
    `[payload] baked tool-policy map ${map.version.slice(0, 12)} (${map.defaults.length} defaults)`,
  );
}
