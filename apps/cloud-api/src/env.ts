// Zod-validated env for `apps/cloud-api` — the SINGLE place `process.env` is
// touched in this app. The hub is a HOSTED service (Chad's servers, Docker):
// unlike the loopback-only local-api, it binds 0.0.0.0 behind the reverse
// proxy and everything secret arrives via env.
//
// Key material: Ed25519 PEMs are multiline — awkward in .env files — so both
// keys arrive BASE64-ENCODED (of the full PEM text). Generate a pair with
// `pnpm cloud:generate-keys`.

import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  parseVynelPortBase,
  resolveVynelPorts,
  type VynelPorts,
} from '@vynel/contracts/network/ports'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> cloud-api -> apps -> repo-root

// Relative path values resolve against the REPO ROOT, never the process cwd —
// turbo runs `dev` with cwd = apps/cloud-api, so a cwd-relative default would
// silently point at files that don't exist there (the local-api DB_PATH
// precedent). A deploy sets absolute paths and is untouched by this.
function resolveAgainstRepoRoot(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

const base64Pem = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    if (!decoded.includes('-----BEGIN')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expected a base64-encoded PEM (run `pnpm cloud:generate-keys`)',
      })
      return z.NEVER
    }
    return decoded
  })

// Port defaults derive from the band (`VYNEL_PORT_BASE`) so one `.env` var
// shifts a whole instance — the worktree story. Explicit vars still win.
function buildEnvSchema(ports: VynelPorts) {
  return z.object({
  CLOUD_PORT: z.coerce.number().int().positive().default(ports.cloudApi),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Pooled URL for the app; the DIRECT (non-pooled) URL for the boot
  // migrator (postgres-phase2.md §1). With no pooler they're the same —
  // DIRECT defaults to the pooled value.
  CLOUD_DATABASE_URL: z.string().min(1),
  CLOUD_DIRECT_DATABASE_URL: z.string().min(1).optional(),
  CLOUD_ACCESS_TOKEN_PRIVATE_KEY: base64Pem,
  CLOUD_ACCESS_TOKEN_PUBLIC_KEY: base64Pem,
  CLOUD_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // The `kid` stamped on signed tokens — bump when rotating the keypair so
  // pinned clients can overlap two keys without a breaking change.
  CLOUD_TOKEN_KEY_ID: z.string().min(1).default('hub-1'),
  CLOUD_ENTITLEMENT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
  // HMAC secret shared with Chad's platform for /platform/webhooks. OPTIONAL:
  // unset = the webhook surface answers 503 (admin provisioning still works).
  CLOUD_PLATFORM_WEBHOOK_SECRET: z.string().min(32).optional(),
  // Bearer for the /admin fallback surface (manual provisioning). Long and
  // random; the platform webhook auth (M3) is separate.
  CLOUD_ADMIN_TOKEN: z.string().min(32),
  // Where set-password links point (the hub's public origin). REQUIRED — a
  // default would mean a prod deploy that forgets it emails localhost links.
  CLOUD_PUBLIC_BASE_URL: z.string().url(),
  // Directory holding marketplace artifact bytes (filesystem ArtifactStore).
  // Defaults under the repo-root .data so dev "just works"; a server deploy
  // points it at a persistent volume. Chad's call (2026-08-02): the server
  // disk IS the store for now — R2 waits for real users.
  CLOUD_ARTIFACT_DIR: z
    .string()
    .default('.data/cloud-artifacts')
    .transform(resolveAgainstRepoRoot),
  // Ed25519 key that signs each published artifact's sha256 — SEPARATE from
  // the token keypair so rotating one never invalidates the other. OPTIONAL:
  // unset = versions publish unsigned and the desktop verifies-if-present.
  // Generate with `pnpm cloud:generate-keys` (its public half is the
  // desktop's VYNEL_HUB_ARTIFACT_KEY).
  CLOUD_ARTIFACT_SIGNING_PRIVATE_KEY: base64Pem.optional(),
  // The upstream-watch cron (Chad 2026-08-02: runs ON the hub). Points at
  // the anthropic-catalog manifest; the default works when the hub runs
  // from the repo (dev + today's deploy). To DISABLE the job, deploy
  // without the file — a missing manifest logs one warning per run and the
  // hub keeps serving.
  CLOUD_UPSTREAM_MANIFEST_PATH: z
    .string()
    .default('scripts/anthropic-catalog/manifest.json')
    .transform(resolveAgainstRepoRoot),
  CLOUD_UPSTREAM_CHECK_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  // Where the desktop updater's latest.json lives. v1 proxies the public
  // releases repo (the same manifest build-desktop.ts publishes); overriding
  // this is how a staging hub points at a staging releases repo.
  CLOUD_RELEASES_MANIFEST_URL: z
    .string()
    .url()
    .default('https://github.com/kafijunior/vynel-releases/releases/latest/download/latest.json'),
  })
}

// Canonical-band schema — the shape (and type) every consumer sees; loadEnv
// parses with the instance's actual band.
export const EnvSchema = buildEnvSchema(resolveVynelPorts())

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  const ports = resolveVynelPorts(parseVynelPortBase(process.env['VYNEL_PORT_BASE']))
  cachedEnv = buildEnvSchema(ports).parse(process.env)
  return cachedEnv
}
