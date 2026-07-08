import type { SpeakResponse } from './schemas.js'

// Deliver spoken text to the voice daemon's loopback overlay channel. The daemon
// owns the speaker, so the api just relays. Best-effort by contract: a daemon
// that isn't running (or errors) yields `{ spoken: false, reason }` — a SUCCESS
// the brain reads as "voice output unavailable, answer in text" rather than a
// hard tool failure. The 4s timeout bounds a hung daemon.

const SPEAK_TIMEOUT_MS = 4_000

export async function speakThroughDaemon(daemonUrl: string, text: string): Promise<SpeakResponse> {
  try {
    const response = await fetch(`${daemonUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { spoken: false, reason: `the voice daemon returned ${response.status}` }
    }
    return { spoken: true }
  } catch {
    return { spoken: false, reason: 'the voice daemon is not running' }
  }
}
