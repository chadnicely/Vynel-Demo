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
  // Silence (ms) in an active conversation before falling back asleep.
  VYNEL_VOICE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Loopback port for the browser Jarvis-view channel (SSE wake/state events).
  VYNEL_VOICE_DAEMON_PORT: z.coerce.number().int().positive().default(VYNEL_VOICE_DAEMON_PORT),
  // '1' = wake opens/focuses the floating Jarvis window (chrome --app) and the
  // browser owns every command session; '0' = the pre-window behavior (hand
  // off only to an already-connected tab, else answer natively).
  VYNEL_VOICE_JARVIS_WINDOW: z.enum(['0', '1']).default('1'),
  // Where the floating window points (local-web's /jarvis route).
  VYNEL_VOICE_JARVIS_URL: z.string().url().default('http://localhost:8999/jarvis'),
  VYNEL_VOICE_JARVIS_BROWSER: z.enum(['chrome', 'msedge']).default('chrome'),
  // The Tauri overlay executable — launched on wake when it exists and no
  // overlay is connected; otherwise the Chrome app-window is the fallback.
  VYNEL_VOICE_JARVIS_APP: z
    .string()
    .default('apps/desktop/src-tauri/target/debug/vynel-desktop.exe')
    .transform(resolveAgainstRepoRoot),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  cachedEnv = EnvSchema.parse(process.env)
  return cachedEnv
}
