// Zod-validated env for the voice daemon — the SINGLE place `process.env` is
// touched in this app (per the coding-standard hard rule). Relative paths resolve
// against the repo root (from this file's location) so the daemon finds the same
// `.models/` regardless of where it was launched, matching apps/local-api/env.ts.

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..') // src -> voice -> apps -> repo-root

function resolveAgainstRepoRoot(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

export const EnvSchema = z.object({
  // The local-api daemon the sidecar sends turns to (loopback, unauthenticated in Phase 1).
  VYNEL_API_URL: z.string().url().default('http://127.0.0.1:8998'),
  // Where the downloaded voice models live (gitignored) — `pnpm voice:fetch-models`.
  VYNEL_VOICE_MODELS_DIR: z.string().default('.models/voice').transform(resolveAgainstRepoRoot),
  // Which TTS voice to speak with: 'kokoro' (11 natural voices) or 'piper-lessac' (small).
  VYNEL_VOICE_TTS: z.enum(['kokoro', 'piper-lessac']).default('kokoro'),
  // Which STT model to hear with: 'moonshine-tiny' (lightest) or 'moonshine-base'
  // (more accurate, still realtime on CPU). Set VYNEL_VOICE_STT=moonshine-base to A/B.
  VYNEL_VOICE_STT: z.enum(['moonshine-tiny', 'moonshine-base']).default('moonshine-tiny'),
  // Speaker id for multi-voice models (Kokoro: 0-10).
  VYNEL_VOICE_ID: z.coerce.number().int().min(0).default(0),
  // Silence (ms) in an active conversation before falling back asleep.
  VYNEL_VOICE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv !== undefined) return cachedEnv
  cachedEnv = EnvSchema.parse(process.env)
  return cachedEnv
}
