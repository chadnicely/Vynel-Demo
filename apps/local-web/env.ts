// The app's env boundary (house rule: no `process.env` outside each app's env.ts).
// Runs in the Vite config context (node), never in the browser bundle — which is
// why this file lives at the app root, physically outside src/.
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
function buildLocalWebEnvSchema(ports: VynelPorts) {
  return z.object({
    /** Dev-server port for the local web UI. */
    LOCAL_WEB_PORT: z.coerce.number().int().positive().default(ports.localWeb),
    /** Where the local API daemon listens; the dev server proxies /api there. */
    LOCAL_API_URL: z.string().url().default(`http://127.0.0.1:${ports.engine}`),
    /** Where the voice daemon's overlay channel listens; proxied at /voice. */
    VYNEL_VOICE_DAEMON_URL: z
      .string()
      .url()
      .default(`http://127.0.0.1:${ports.voiceDaemon}`),
  });
}

export type LocalWebEnv = z.infer<ReturnType<typeof buildLocalWebEnvSchema>>;

/** Pure parse — exported for tests. Unknown keys are stripped by Zod. */
export function parseLocalWebEnv(
  source: Record<string, string | undefined>,
): LocalWebEnv {
  const ports = resolveVynelPorts(parseVynelPortBase(source["VYNEL_PORT_BASE"]));
  return buildLocalWebEnvSchema(ports).parse(source);
}

/** Load the repo-root .env (shared with local-api), then let real env vars win. */
export function loadLocalWebEnv(mode: string): LocalWebEnv {
  const repoRootDir = fileURLToPath(new URL("../..", import.meta.url));
  return parseLocalWebEnv({
    ...loadEnv(mode, repoRootDir, ""),
    ...process.env,
  });
}
