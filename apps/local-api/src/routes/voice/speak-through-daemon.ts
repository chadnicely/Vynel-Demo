import type { SpeakResponse } from './schemas.js'

// Deliver spoken text to the voice daemon's loopback overlay channel. The daemon
// owns the speaker, so the api just relays. Best-effort by contract: a daemon
// that isn't running (or errors) yields `{ spoken: false, reason }` — a SUCCESS
// the brain reads as "voice output unavailable, answer in text" rather than a
// hard tool failure. The 4s timeout bounds a hung daemon.
//
// `sessionId` names the PRODUCING chat session (the ambient turn-session
// header — never model input; null when the caller has no turn session, e.g. a
// schedule fire). The daemon carries it on the relayed line so a browser client
// can tell its own turn's line from another session's instead of dropping both.

const SPEAK_TIMEOUT_MS = 4_000

export async function speakThroughDaemon(
  daemonUrl: string,
  text: string,
  sessionId: string | null,
): Promise<SpeakResponse> {
  try {
    const response = await fetch(`${daemonUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, sessionId }),
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
