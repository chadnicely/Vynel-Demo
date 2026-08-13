// Zod-validated env for the voice daemon — the SINGLE place `process.env` is
// touched in this app (per the coding-standard hard rule). Relative paths resolve
// against the repo root (from this file's location) so the daemon finds the same
// `.models/` regardless of where it was launched, matching apps/local-api/env.ts.

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { VYNEL_ENGINE_PORT, VYNEL_VOICE_DAEMON_PORT } from '@vynel/contracts/network/ports'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> voice -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

export const EnvSchema = z.object({
  // The local-api daemon the sidecar sends turns to (loopback, unauthenticated in Phase 1).
  VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${VYNEL_ENGINE_PORT}`),
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
  // Loopback port for the browser Jarvis-view channel (SSE wake/state events).
  VYNEL_VOICE_DAEMON_PORT: z.coerce.number().int().positive().default(VYNEL_VOICE_DAEMON_PORT),
  // '1' = wake opens/focuses the floating Jarvis window (chrome --app) and the
  // browser owns every command session; '0' = the pre-window behavior (hand
  // off only to an already-connected tab, else answer natively).
  VYNEL_VOICE_JARVIS_WINDOW: z.enum(['0', '1']).default('1'),
  // Where the floating window points (local-web's /jarvis route).
  VYNEL_VOICE_JARVIS_URL: z.string().url().default('http://localhost:18894/jarvis'),
  VYNEL_VOICE_JARVIS_BROWSER: z.enum(['chrome', 'msedge']).default('chrome'),
  // The Tauri overlay executable — launched on wake when it exists and no
  // overlay is connected; otherwise the Chrome app-window is the fallback.
  VYNEL_VOICE_JARVIS_APP: z
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

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  cachedEnv = EnvSchema.parse(process.env)
  return cachedEnv
}
