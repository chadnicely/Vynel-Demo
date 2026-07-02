// Zod-validated env for `apps/worker`. The SINGLE place `process.env` is
// touched in this app — per `docs/foundation.md §2 row 13 + §11 hard rule
// #2` + `.claude/rules/coding-standard.md`.
//
// Mirrors `apps/api/src/env.ts` so both processes parse the same vars;
// PORT is api-only.
//
// DB_PATH resolution: a relative path is resolved against the repo root
// (computed from this file's location), NOT against process.cwd(). This
// keeps the api + worker pointed at the SAME file regardless of where
// each process was started from. The api owns migrations at its boot;
// the worker assumes they've run (apps/worker/src/index.ts comment).
// That assumption only holds when both processes open the same DB file.
// Discovered 2026-05-24 — the worker created a fresh empty DB next to
// itself and crashed querying approval_requests.

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> worker -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

export const EnvSchema = z.object({
  DB_DIALECT: z.enum(['sqlite', 'postgres']).default('sqlite'),
  // Defaults to the one canonical dev DB at the repo root, so a launch without
  // an `.env` still lands on the single shared file (not a per-CWD stray). `.env`
  // overrides for non-default setups. Mirrors apps/api/src/env.ts.
  DB_PATH: z.string().default('.data/vynel.dev.db').transform(resolveAgainstRepoRoot),
  DB_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  cachedEnv = EnvSchema.parse(process.env)
  return cachedEnv
}
