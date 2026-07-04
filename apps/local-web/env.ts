// The app's env boundary (house rule: no `process.env` outside each app's env.ts).
// Runs in the Vite config context (node), never in the browser bundle — which is
// why this file lives at the app root, physically outside src/.
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { z } from "zod";

const LocalWebEnvSchema = z.object({
  /** Dev-server port for the local web UI. */
  LOCAL_WEB_PORT: z.coerce.number().int().positive().default(8999),
  /** Where the local API daemon listens; the dev server proxies /api there. */
  LOCAL_API_URL: z.string().url().default("http://127.0.0.1:8998"),
});

export type LocalWebEnv = z.infer<typeof LocalWebEnvSchema>;

/** Pure parse — exported for tests. Unknown keys are stripped by Zod. */
export function parseLocalWebEnv(
  source: Record<string, string | undefined>,
): LocalWebEnv {
  return LocalWebEnvSchema.parse(source);
}

/** Load the repo-root .env (shared with local-api), then let real env vars win. */
export function loadLocalWebEnv(mode: string): LocalWebEnv {
  const repoRootDir = fileURLToPath(new URL("../..", import.meta.url));
  return parseLocalWebEnv({
    ...loadEnv(mode, repoRootDir, ""),
    ...process.env,
  });
}
