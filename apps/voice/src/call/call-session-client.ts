import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import {
  streamTurnEvents,
  VOICE_MODE,
  VOICE_MODEL,
  VOICE_THINKING_EFFORT,
} from '../brain/run-brain-turn.js'

// The daemon's client for the per-call spawned session: create it (global-
// grounded — the `purpose` IS the priming payload: goal, mode, disclosure) and
// run one turn per participant utterance. Rides the exact SSE wire the wake
// line uses; the call loop owns turning the reply text into speech — unlike
// the wake line, a call session's text IS its voice (no speak-tool round-trip
// per utterance).

export interface CallSessionClient {
  createCallSession(input: { name: string; purpose: string }): Promise<{ sessionId: string }>
  runCallTurn(sessionId: string, utterance: string): AsyncIterable<VoiceBrainEvent>
}

export function createCallSessionClient(apiUrl: string): CallSessionClient {
  return {
    async createCallSession(input) {
      const response = await fetch(`${apiUrl}/sessions/spawned`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.name, purpose: input.purpose }),
      })
      if (!response.ok) {
        throw new Error(
          `creating the call session failed (${response.status}) — is local-api up at ${apiUrl}?`,
        )
      }
      const created = (await response.json()) as { sessionId: string }
      return { sessionId: created.sessionId }
    },
    runCallTurn(sessionId, utterance) {
      // A live call is a VOICE leg like the wake line: `voice: true` makes the
      // server force the tier (and read/write no settings), and the tier goes on
      // the wire too so the daemon is honest about what it asked for. Without
      // it the call session fell to the interactive default and a floor tool
      // carded a live call nobody could answer (session audit A2/A3/V-a).
      return streamTurnEvents(`${apiUrl}/sessions/${sessionId}/turn`, {
        userMessageText: utterance,
        model: VOICE_MODEL,
        thinkingEffort: VOICE_THINKING_EFFORT,
        mode: VOICE_MODE,
        voice: true,
      })
    },
  }
}
