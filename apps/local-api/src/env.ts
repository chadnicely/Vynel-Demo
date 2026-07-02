// Zod-validated env for `apps/local-api`. The SINGLE place `process.env` is
// touched in this app — per `docs/foundation.md §2 row 13 + §11 hard rule
// #2` + the always-on `.claude/rules/coding-standard.md`. Bodies / Zod
// schemas filled by `/build-domain users` TDD step 18 (per
// `docs/blueprints/users/blueprint.md §16`).
//
// DB_PATH resolution: a relative path is resolved against the repo root
// (computed from this file's location — three levels up from
// apps/local-api/src/env.ts: src -> api -> apps -> repo-root), NOT against
// process.cwd(). This keeps the api +
// worker pointed at the SAME file regardless of where each process was
// started from. better-sqlite3 resolves relative paths against
// process.cwd() by default, which would create per-app DBs when each app
// runs from its own folder. Discovered 2026-05-24 — the worker created a
// fresh empty DB next to itself instead of opening the api's migrated
// one, then crashed querying `approval_requests`. apps/worker/src/env.ts
// mirrors this resolution exactly.

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> api -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

export const EnvSchema = z.object({
  DB_DIALECT: z.enum(['sqlite', 'postgres']).default('sqlite'),
  // Defaults to the one canonical dev DB at the repo root, so a launch without
  // an `.env` still lands on the single shared file (not a per-CWD stray). `.env`
  // overrides for non-default setups.
  DB_PATH: z.string().default('.data/vynel.dev.db').transform(resolveAgainstRepoRoot),
  DB_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().positive().default(8998),
  // Dev/test override for the session-continuity swap trigger (Slice 2). When
  // set (0–1), a root-as-thread turn swaps at this context-occupancy ratio
  // instead of the production default 0.85 — used by the live UI swap smoke to
  // fire a swap in a few turns. Unset in production. Consumed by
  // `streamChatTurn` → `applyRootTurnContinuity`.
  VYNEL_CONTEXT_PRESSURE_THRESHOLD: z.coerce.number().gt(0).lte(1).optional(),
  // The hidden user-level data directory the GLOBAL root (Slice 3b) runs in as
  // its SDK cwd — like `.claude`, NOT a workspace folder. Absolute path; unset
  // defaults to `<home>/.vynel` (resolved in `sessions/global-root-workspace.ts`).
  VYNEL_USER_DATA_DIR: z.string().optional(),
  // Enable the MUTATING desktop `act_on_app` tool (click / type). Default OFF —
  // a deliberate off-switch so the agent can't act on the desktop unless the
  // user opts in (`=1` or `=true`). The hard approval gate is a separate
  // end-step; until then the real interim safety is an isolated environment +
  // this flag, NOT the prompt. See `.claude/memory/decisions/desktop-control-mcp-server.md`.
  VYNEL_DESKTOP_ACT_ENABLED: z
    .string()
    .default('0')
    .transform((raw) => raw === '1' || raw.toLowerCase() === 'true'),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  cachedEnv = EnvSchema.parse(process.env)
  return cachedEnv
}
