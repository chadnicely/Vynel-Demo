import type { VoiceReloadOutcome, VoiceReloadResponse } from '@vynel/contracts/voice/voice-reload'

// Ask the voice daemon to apply the user's voice pick now (Settings → Voice
// saved). Best-effort by contract, like `speak`: a daemon that isn't running
// yields `{ reloaded: false, reason }` — the pick is saved either way and the
// daemon reads it at its next start. The timeout covers a model load.

const RELOAD_TIMEOUT_MS = 30_000

export async function reloadVoiceThroughDaemon(daemonUrl: string): Promise<VoiceReloadResponse> {
  try {
    const response = await fetch(`${daemonUrl}/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(RELOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { reloaded: false, reason: `the voice daemon returned ${response.status}` }
    }
    const outcome = (await response.json()) as VoiceReloadOutcome
    return { reloaded: true, ...outcome }
  } catch {
    return { reloaded: false, reason: 'the voice daemon is not running' }
  }
}
