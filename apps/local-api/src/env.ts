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
import {
  VYNEL_PORT_BASE_DEFAULT,
  parseVynelPortBase,
  resolveVynelPorts,
} from '@vynel/contracts/network/ports'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> api -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

// For vars with a Zod default — the value is never undefined, and the type
// should say so rather than make every reader guard a case that cannot happen.
function resolveRequiredAgainstRepoRoot(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

// Port and URL defaults derive from the band (`VYNEL_PORT_BASE`), so ONE
// `.env` var shifts a whole instance — the worktree story. Explicit vars
// still win over the derived defaults.
function buildEnvSchema(portBase: number) {
  const ports = resolveVynelPorts(portBase)
  return z.object({
  // The instance's band base — surfaced as a field so consumers (the engine
  // port file) can name which band this instance belongs to.
  VYNEL_PORT_BASE: z.coerce.number().int().positive().default(portBase),
  DB_DIALECT: z.enum(['sqlite', 'postgres']).default('sqlite'),
  // Defaults to the one canonical dev DB at the repo root, so a launch without
  // an `.env` still lands on the single shared file (not a per-CWD stray). `.env`
  // overrides for non-default setups.
  DB_PATH: z.string().default('.data/vynel.dev.db').transform(resolveAgainstRepoRoot),
  DB_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().positive().default(ports.engine),
  // Dev/test override for the session-continuity swap trigger (Slice 2). When
  // set (0–1), a root-as-thread turn swaps at this context-occupancy ratio
  // instead of the production default 0.85 — used by the live UI swap smoke to
  // fire a swap in a few turns. Unset in production. Consumed by
  // `streamChatTurn` → `applyRootTurnContinuity`.
  VYNEL_CONTEXT_PRESSURE_THRESHOLD: z.coerce.number().gt(0).lte(1).optional(),
  // How many delegated runs (child sessions, routed tasks, agent runs) may live at
  // once — each is a Claude CLI subprocess. Default 3 (Chad, 2026-07-21); becomes a
  // user-facing setting in the settings arc. Bounded: a runaway value would fan out
  // that many subprocesses against the account's rate limits.
  VYNEL_MAX_CONCURRENT_DELEGATIONS: z.coerce.number().int().min(1).max(32).default(3),
  // ── Bounds (session-hardening arc, Kafi 2026-08-19: "every wait has a bound
  // and an owner"). All in milliseconds; each clock SUSPENDS while a turn is
  // parked on a human decision (approval card / ask), so the bound measures
  // working time, not deciding time.
  // A delegated run (task / agent run / delivery) holds its target lock for its
  // WHOLE run; past this cap the run is cancelled through the cancel registry,
  // the job settles `failed` with an honest failure delivery. Replaces the old
  // 600 s "stop waiting" budget that released the lock under a live turn.
  VYNEL_DELEGATED_TURN_MAX_MS: z.coerce.number().int().positive().default(3_600_000),
  // An interactive turn (global / workspace / spawned DM, and channel-driven global turns) is interrupted past
  // this wall clock and records a failure row — the root lock and the target
  // locks can no longer be held forever by one hung provider await.
  VYNEL_INTERACTIVE_TURN_MAX_MS: z.coerce.number().int().positive().default(3_600_000),
  // How long an interactive turn may sit in a LOCK QUEUE before it gives up
  // (audit R2-J): the wall clock above bounds the turn that HOLDS the lock,
  // this bounds the waiters behind it — without it N queued turns behind one
  // wedged holder wait N x the cap. Unset = the interactive cap, so lowering
  // that lowers the queue with it (`resolveLockWaitMaxMs`, the one home).
  VYNEL_LOCK_WAIT_MAX_MS: z.coerce.number().int().positive().optional(),
  // How long an interactive `ask_user` form may stay unanswered before it
  // expires with a note (the 60 s asks reaper enforces it for rows whose waiter
  // died). Channels keep their own 10 min bound; voice never attaches ask_user.
  VYNEL_INTERACTIVE_ASK_MAX_MS: z.coerce.number().int().positive().default(7_200_000),
  // The claim lease on a delegation job: a claim sets `leaseExpiresAt = now +
  // lease`, the running tick heartbeats every `heartbeat`; the sweeper settles
  // an expired lease by kind (report/note/direct requeue, task/agent-run fail).
  VYNEL_DELEGATION_LEASE_MS: z.coerce.number().int().positive().default(180_000),
  // Must fit at least twice inside the lease (checked below): a heartbeat that
  // cannot renew before the lease expires would let the sweeper reap every
  // live run on its first pass.
  VYNEL_DELEGATION_HEARTBEAT_MS: z.coerce.number().int().positive().default(30_000),
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
  // The first-launch onboarding gate (412s every non-onboarding route until the
  // single local user finishes setup). Default ON — production-safe; the web
  // client is meant to catch the 412 and show a wizard. Set `=0`/`=false` in a
  // dev `.env` to run the UI against a fresh DB before the onboarding wizard
  // exists. Consumed by `server.ts` → `createApp({ enableFirstLaunchGate })`.
  VYNEL_FIRST_LAUNCH_GATE_ENABLED: z
    .string()
    .default('1')
    .transform((raw) => raw === '1' || raw.toLowerCase() === 'true'),
  // The voice daemon's loopback overlay channel — the `speak` MCP tool POSTs the
  // brain's spoken text here (the daemon owns the speaker). Best-effort: if the
  // daemon isn't running, `speak` reports it couldn't (the brain falls back to text).
  VYNEL_VOICE_DAEMON_URL: z.string().url().default(`http://127.0.0.1:${ports.voiceDaemon}`),
  // Where the BUILT local-web bundle lives. When an index.html exists there at
  // boot, the gateway serves the whole desktop UI from this process (sidecar
  // mode — the Tauri shell points its windows at us); when absent, the api runs
  // bare and the Vite dev server fronts the UI. Repo-root-resolved like DB_PATH.
  VYNEL_WEB_UI_DIST: z.string().default('apps/local-web/dist').transform(resolveAgainstRepoRoot),
  // Where the embedding model cache lives — OUTSIDE node_modules so reinstalls
  // and interrupted first downloads can't poison it (@vynel/embeddings; the
  // voice-models `.models/` precedent). Repo-root-resolved like DB_PATH.
  VYNEL_EMBEDDINGS_CACHE_DIR: z
    .string()
    .default('.models/embeddings')
    .transform(resolveRequiredAgainstRepoRoot),
  // Where the voice models live — the SAME directory the voice daemon reads
  // (`apps/voice/src/env.ts`), so what Settings → Voice downloads is what the
  // daemon loads. Repo-root-resolved like the embeddings cache.
  VYNEL_VOICE_MODELS_DIR: z
    .string()
    .default('.models/voice')
    .transform(resolveRequiredAgainstRepoRoot),
  // Where the packaged build's shipped content lives (migrations-sqlite/,
  // instructions/) — set by the desktop shell (and the release smoke) in
  // bundled mode, where package-relative resolution can't work because all
  // @vynel code is compiled into one bundle. Unset in dev: every asset
  // resolves package-relative as before. Repo-root-resolved like DB_PATH.
  VYNEL_ASSETS_DIR: z.string().optional().transform(resolveAgainstRepoRoot),
  // The installed app's version, stamped by the desktop shell when it spawns
  // the bundled daemon (tauri.conf.json is the source of truth). Unset in dev
  // — consumers fall back to the 0.0.0 placeholder.
  VYNEL_APP_VERSION: z.string().optional(),
  // Where the sealing master key lives when the OS keyring can't (headless
  // servers — Phase D remote engines — have no Secret Service; the keyring
  // impl would throw at boot). Set = file vault (owner-only file, minted on
  // first boot); unset = the OS keyring as before. Repo-root-resolved like
  // DB_PATH, absolute in practice (the systemd unit passes the install dir).
  VYNEL_MASTER_KEY_FILE: z.string().optional().transform(resolveAgainstRepoRoot),
  // Set = every gateway request must carry `Authorization: Bearer <token>` —
  // the remote engine's defense against OTHER LOCAL USERS on a shared server
  // (the daemon stays loopback-bound; the desktop tunnel injects the header;
  // /health stays open for the version handshake). Unset = local mode, where
  // the loopback bind is the security model. Min length keeps a provisioner
  // bug from shipping a guessable token.
  VYNEL_AUTH_TOKEN: z.string().min(16).optional(),
  // Marks this daemon as a REMOTE engine (Phase D systemd install on a user's
  // server). Local-machine features answer honestly instead of probing dead
  // loopbacks: `speak` reports voice unavailable without a daemon round-trip.
  VYNEL_REMOTE_ENGINE: z
    .string()
    .default('0')
    .transform((raw) => raw === '1' || raw.toLowerCase() === 'true'),
  // The linux engine payload the server-install routes provision with (a
  // `release:pack` tar.gz; its `.sha256` sidecar must sit beside it). Dev
  // seam — Phase D5 replaces it with a release download. Unset = the routes
  // answer that no payload is available. Repo-root-resolved like DB_PATH.
  VYNEL_SERVER_PAYLOAD_ARCHIVE: z.string().optional().transform(resolveAgainstRepoRoot),
  // Which remote engine install the TUNNEL entry (tunnel.ts) targets. Unset =
  // the newest healthy install — the shell passes an explicit id once the D4
  // engine-location config carries one.
  VYNEL_REMOTE_INSTALL_ID: z.string().optional(),
  // The Vynel HUB (apps/cloud-api, hosted) — accounts + tiers + marketplace.
  // OPTIONAL: unset = hub features off (the /hub routes answer
  // `not-configured`), so dev without a hub keeps working.
  VYNEL_HUB_URL: z.string().url().optional(),
  // The hub's PINNED public key (base64-encoded SPKI PEM — the same value as
  // the hub's CLOUD_ACCESS_TOKEN_PUBLIC_KEY). Verifies entitlement tokens
  // OFFLINE; required whenever a hub is configured. D2's installer bakes it.
  VYNEL_HUB_PUBLIC_KEY: z
    .string()
    .transform((raw) => Buffer.from(raw, 'base64').toString('utf8'))
    .optional(),
  // The hub's PINNED artifact-signing public key (base64 SPKI PEM — the
  // `VYNEL_HUB_ARTIFACT_KEY` line `pnpm cloud:generate-keys` prints).
  // OPTIONAL even with a hub configured: absent = downloaded artifacts skip
  // signature verification (the rollout state; sha256 checks still guard
  // installs). D2's installer bakes it beside VYNEL_HUB_PUBLIC_KEY.
  VYNEL_HUB_ARTIFACT_KEY: z
    .string()
    .transform((raw) => Buffer.from(raw, 'base64').toString('utf8'))
    .optional(),
  }).superRefine((env, ctx) => {
    if (env.VYNEL_DELEGATION_HEARTBEAT_MS * 2 > env.VYNEL_DELEGATION_LEASE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VYNEL_DELEGATION_HEARTBEAT_MS'],
        message:
          'VYNEL_DELEGATION_HEARTBEAT_MS must be at most half of VYNEL_DELEGATION_LEASE_MS — a heartbeat that cannot renew before the lease expires would let the sweeper reap every live delegated run.',
      })
    }
    if (env.VYNEL_HUB_URL !== undefined && env.VYNEL_HUB_PUBLIC_KEY === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VYNEL_HUB_PUBLIC_KEY'],
        message:
          'VYNEL_HUB_URL is set but VYNEL_HUB_PUBLIC_KEY is not — copy the hub keypair’s public half (base64 PEM).',
      })
    }
  })
}

// Canonical-band schema — the shape (and type) every consumer sees; loadEnv
// parses with the instance's actual band.
export const EnvSchema = buildEnvSchema(VYNEL_PORT_BASE_DEFAULT)

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  const portBase = parseVynelPortBase(process.env['VYNEL_PORT_BASE'])
  cachedEnv = buildEnvSchema(portBase).parse(process.env)
  return cachedEnv
}

/** How long an interactive turn may wait in a lock queue — ONE home for the
 *  "unset = the interactive cap" derivation the streams all read (R2-J). */
export function resolveLockWaitMaxMs(env: Env): number {
  return env.VYNEL_LOCK_WAIT_MAX_MS ?? env.VYNEL_INTERACTIVE_TURN_MAX_MS
}
