// The app's env boundary (house rule: no `process.env` outside each app's
// env.ts). Runs in the Vite config context (node), never in the browser
// bundle — which is why this file lives at the app root, physically outside
// src/. Mirrors apps/local-web/env.ts.
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { z } from "zod";
import {
  parseVynelPortBase,
  resolveVynelPorts,
  type VynelPorts,
} from "@vynel/contracts/network/ports";

// Port and URL defaults derive from the band (`VYNEL_PORT_BASE`) so one
// `.env` var shifts a whole instance — the worktree story. Explicit vars
// still win.
function buildCloudAdminWebEnvSchema(ports: VynelPorts) {
  return z.object({
    /** Dev-server port for the hub admin portal. */
    CLOUD_ADMIN_WEB_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(ports.cloudAdminWeb),
    /** Where the hub api listens; the dev server proxies /api there. */
    CLOUD_API_URL: z.string().url().default(`http://localhost:${ports.cloudApi}`),
  });
}

export type CloudAdminWebEnv = z.infer<
  ReturnType<typeof buildCloudAdminWebEnvSchema>
>;

/** Pure parse — exported for tests. Unknown keys are stripped by Zod. */
export function parseCloudAdminWebEnv(
  source: Record<string, string | undefined>,
): CloudAdminWebEnv {
  const ports = resolveVynelPorts(parseVynelPortBase(source["VYNEL_PORT_BASE"]));
  return buildCloudAdminWebEnvSchema(ports).parse(source);
}

/** Load the repo-root .env (shared with the apis), then let real env vars win. */
export function loadCloudAdminWebEnv(mode: string): CloudAdminWebEnv {
  const repoRootDir = fileURLToPath(new URL("../..", import.meta.url));
  return parseCloudAdminWebEnv({
    ...loadEnv(mode, repoRootDir, ""),
    ...process.env,
  });
}
