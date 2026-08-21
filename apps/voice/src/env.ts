// Zod-validated env for the voice daemon — the SINGLE place `process.env` is
// touched in this app (per the coding-standard hard rule). Relative paths resolve
// against the repo root (from this file's location) so the daemon finds the same
// `.models/` regardless of where it was launched, matching apps/local-api/env.ts.

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  defaultUserDataDir,
  enginePortFilePath,
  resolveEngineUrl,
} from '@vynel/contracts/network/port-file'
import {
  VYNEL_PORT_BASE_DEFAULT,
  parseVynelPortBase,
  resolveVynelPorts,
} from '@vynel/contracts/network/ports'
import { DEFAULT_VOICE_TURN_WATCHDOG_MS } from '@vynel/contracts/voice/turn-watchdog'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> voice -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

// Port and URL defaults derive from the band (`VYNEL_PORT_BASE`) so one
// `.env` var shifts a whole instance — the worktree story. Explicit vars
// still win.
function buildEnvSchema(portBase: number) {
  const ports = resolveVynelPorts(portBase)
  return z.object({
  VYNEL_PORT_BASE: z.coerce.number().int().positive().default(portBase),
  // Where the engine advertises its port file — must mirror the engine's own
  // VYNEL_USER_DATA_DIR or discovery silently misses it.
  VYNEL_USER_DATA_DIR: z.string().optional(),
  // The local-api daemon the sidecar sends turns to (loopback, unauthenticated in Phase 1).
  VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${ports.engine}`),
  // Where the downloaded voice models live (gitignored) — `pnpm voice:fetch-models`.
  VYNEL_VOICE_MODELS_DIR: z.string().default('.models/voice').transform(resolveAgainstRepoRoot),
  // Which TTS voice to speak with: 'kokoro' (11 natural voices) or 'piper-lessac' (small).
  VYNEL_VOICE_TTS: z.enum(['kokoro', 'piper-lessac']).default('kokoro'),
  // Which STT model to hear with: 'moonshine-base' (default — the accuracy sweet
  // spot, still realtime on CPU) or 'moonshine-tiny' (lightest, less accurate).
  VYNEL_VOICE_STT: z.enum(['moonshine-tiny', 'moonshine-base']).default('moonshine-base'),
  // Speaker id for multi-voice models (Kokoro: 0-10).
  VYNEL_VOICE_ID: z.coerce.number().int().min(0).default(0),
  // Optional explicit audio devices — exact names as node-cpal enumerates them
  // (e.g. "CABLE Output (VB-Audio Virtual Cable)"). Unset = the system default
  // device, exactly today's behavior. A name that doesn't resolve logs an
  // actionable error and falls back to the default rather than crashing — an
  // uninstalled cable must not take the daemon down.
  VYNEL_VOICE_INPUT_DEVICE: z.string().min(1).optional(),
  VYNEL_VOICE_OUTPUT_DEVICE: z.string().min(1).optional(),
  // The call cable inventory (voice-in-calls, docs/module-notes/voice-in-calls.md).
  // Unlike the two above these NEVER fall back to a default device — a call
  // must not capture the real mic or speak over the real speakers. Each PAIR
  // carries one concurrent call; pair 2 is optional (a second installed cable
  // set). A half-set pair fails at boot — see the refine below.
  // Cable B's capture end — the call app's speaker plays into it (call audio in):
  VYNEL_CALL_INPUT_DEVICE: z.string().min(1).optional(),
  // Cable A's playback end — the call app's microphone (Vynel's call voice out):
  VYNEL_CALL_OUTPUT_DEVICE: z.string().min(1).optional(),
  VYNEL_CALL_INPUT_DEVICE_2: z.string().min(1).optional(),
  VYNEL_CALL_OUTPUT_DEVICE_2: z.string().min(1).optional(),
  // How many runtime null-sink cable pairs the daemon creates at boot on
  // Linux (PipeWire/PulseAudio — no driver, no install; the modules vanish
  // with the daemon and stale ones are reaped at the next boot). 0 disables.
  // Ignored on Windows/macOS, where pairs come from discovery or the env
  // pairs above.
  VYNEL_CALL_LINUX_PAIRS: z.coerce.number().int().min(0).max(8).default(2),
  // Silence (ms) in an active conversation before falling back asleep.
  VYNEL_VOICE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // The daemon's per-turn WATCHDOG (session-hardening arc, Kafi 2026-08-19):
  // a wake-line turn SILENT (no text yet) for this long makes the driver say
  // "still working — I'll tell you when it's done" and hand the room back,
  // while the turn streams on in the background and its answer is spoken
  // when it lands. A call turn measures time in flight instead (its caller
  // hears nothing until the reply is whole). The default is the contracts'
  // one home — the browser leg falls back to the same number without a wake.
  VYNEL_VOICE_TURN_WATCHDOG_MS: z.coerce.number().int().positive().default(DEFAULT_VOICE_TURN_WATCHDOG_MS),
  // Loopback port for the browser voice-view channel (SSE wake/state events).
  VYNEL_VOICE_DAEMON_PORT: z.coerce.number().int().positive().default(ports.voiceDaemon),
  // '1' = wake opens/focuses the display dock (chrome --app / the desktop
  // shell's dock webview) and the browser owns every command session;
  // '0' = the native leg answers unless a wake-capable BROWSER tab
  // (Web Speech, outside the desktop shell) is connected. The desktop shell's
  // own windows never take a wake with the feature off — its main window
  // declares no wake capability and its hidden dock webview (always
  // connected) is not a target on the 'app' wake surface.
  VYNEL_VOICE_DOCK_WINDOW: z.enum(['0', '1']).default('1'),
  // Where the dock window points (local-web's /display-dock route).
  VYNEL_VOICE_DOCK_URL: z.string().url().default(`http://localhost:${ports.localWeb}/display-dock`),
  VYNEL_VOICE_DOCK_BROWSER: z.enum(['chrome', 'msedge']).default('chrome'),
  // The Tauri overlay executable — launched on wake when it exists and no
  // overlay is connected; otherwise the Chrome app-window is the fallback.
  VYNEL_VOICE_DOCK_APP: z
    .string()
    .default('apps/desktop/src-tauri/target/debug/vynel-desktop.exe')
    .transform(resolveAgainstRepoRoot),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
}).superRefine((env, context) => {
  // A half-configured cable pair is always a typo — fail at boot with the gap
  // named, not at start-call time with a confusing not-configured.
  const pairs: Array<[string, string | undefined, string, string | undefined]> = [
    ['VYNEL_CALL_INPUT_DEVICE', env.VYNEL_CALL_INPUT_DEVICE, 'VYNEL_CALL_OUTPUT_DEVICE', env.VYNEL_CALL_OUTPUT_DEVICE],
    ['VYNEL_CALL_INPUT_DEVICE_2', env.VYNEL_CALL_INPUT_DEVICE_2, 'VYNEL_CALL_OUTPUT_DEVICE_2', env.VYNEL_CALL_OUTPUT_DEVICE_2],
  ]
  for (const [inputName, input, outputName, output] of pairs) {
    if ((input === undefined) !== (output === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${input === undefined ? inputName : outputName} is missing — a call cable pair needs BOTH ends set`,
      })
    }
  }
  })
}

// Canonical-band schema — the shape (and type) every consumer sees; loadEnv
// parses with the instance's actual band.
export const EnvSchema = buildEnvSchema(VYNEL_PORT_BASE_DEFAULT)

export type Env = z.infer<typeof EnvSchema>

// The display-dock rename (2026-08-21) renamed four user-facing knobs. An
// existing `.env` must keep working for one release, so each OLD name is read
// as a fallback HERE — one home, applied to the raw object before the schema
// ever sees it, rather than four per-field `preprocess` hooks. The NEW name
// wins when both are set: an explicit new value is the user's current intent.
// Drop this map (and its test) one release after the rename ships.
const DEPRECATED_ENV_ALIASES: ReadonlyMap<string, string> = new Map([
  ['VYNEL_VOICE_JARVIS_WINDOW', 'VYNEL_VOICE_DOCK_WINDOW'],
  ['VYNEL_VOICE_JARVIS_URL', 'VYNEL_VOICE_DOCK_URL'],
  ['VYNEL_VOICE_JARVIS_BROWSER', 'VYNEL_VOICE_DOCK_BROWSER'],
  ['VYNEL_VOICE_JARVIS_APP', 'VYNEL_VOICE_DOCK_APP'],
])

/** Pure: a COPY of `raw` where each deprecated name fills its replacement when
 *  the replacement is unset. Exported so the alias is tested without touching
 *  `process.env`. */
export function applyDeprecatedVoiceEnvAliases(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...raw }
  for (const [deprecatedName, currentName] of DEPRECATED_ENV_ALIASES) {
    const deprecatedValue = raw[deprecatedName]
    if (deprecatedValue !== undefined && merged[currentName] === undefined) {
      merged[currentName] = deprecatedValue
    }
  }
  return merged
}

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  const portBase = parseVynelPortBase(process.env['VYNEL_PORT_BASE'])
  const env = buildEnvSchema(portBase).parse(applyDeprecatedVoiceEnvAliases(process.env))
  // No explicit URL → prefer the port a LIVE engine of OUR band advertises
  // (the desktop shell may have allocated a non-default one), then the band
  // default.
  const explicitUrl = process.env['VYNEL_API_URL'] === undefined ? undefined : env.VYNEL_API_URL
  const portFilePath = enginePortFilePath(portBase, env.VYNEL_USER_DATA_DIR ?? defaultUserDataDir())
  env.VYNEL_API_URL = resolveEngineUrl(explicitUrl, resolveVynelPorts(portBase).engine, portFilePath)
  cachedEnv = env
  return cachedEnv
}
