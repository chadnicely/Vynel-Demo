import { Readable } from 'node:stream'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import { parseSseFrames, type SseFrame } from '@vynel/sdk'

// The brain client: POST an utterance to local-api's `/root/turn` and stream the
// answer back as `VoiceBrainEvent`s (the driver's `runBrainTurn`). The SSE frames
// carry the full `ChatTurnEvent` union; voice only needs the text + the terminal.

/** Map one SSE frame to a `VoiceBrainEvent`, or null for frames voice ignores
 *  (thinking, tool calls, approvals, usage, the context-swap frames). Pure —
 *  unit-tested.
 *
 *  The turn is COMPLETE at `session-completed` — the answer is fully spoken /
 *  written by then. `turn-stream-ended` (the transport's terminal frame) can
 *  arrive tens of seconds later when the conversation continues on a fresh
 *  context at the turn boundary (`context-patching` → `context-patched` ride
 *  the stream in between); voice has no chip to show for that, so a daemon
 *  waiting on the terminal frame sat "thinking" through the whole swap with the
 *  reply queued behind it. Completing on the session's own end frees the loop
 *  the moment the answer is done; the swap finishes server-side regardless. */
export function mapFrameToBrainEvent(frame: SseFrame): VoiceBrainEvent | null {
  if (frame.event === 'turn-stream-ended') return { kind: 'completed' }

  let payload: unknown
  try {
    payload = JSON.parse(frame.data)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const event = payload as Record<string, unknown>

  if (event.kind === 'text-chunk' && typeof event.textDelta === 'string') {
    return { kind: 'text', delta: event.textDelta }
  }
  if (event.kind === 'session-completed') return { kind: 'completed' }
  if (event.kind === 'session-errored') {
    return {
      kind: 'failed',
      message: typeof event.errorMessage === 'string' ? event.errorMessage : 'the turn failed',
    }
  }
  if (event.kind === 'session-interrupted') {
    return { kind: 'failed', message: 'the turn was interrupted' }
  }
  return null
}

// The small, fast model every voice turn runs on (the light triage tier) —
// the wake line and the call loop alike.
export const VOICE_MODEL = 'claude-haiku-4-5'

/** POST a turn request and stream the reply as `VoiceBrainEvent`s — the ONE
 *  home for the SSE turn wire; the wake line (`/root/turn`) and the call
 *  session client (`/sessions/:id/turn`) differ only in URL and body. */
export async function* streamTurnEvents(
  url: string,
  body: Record<string, unknown>,
): AsyncIterable<VoiceBrainEvent> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    yield { kind: 'failed', message: error instanceof Error ? error.message : 'brain unreachable' }
    return
  }

  if (!response.ok || response.body === null) {
    yield { kind: 'failed', message: `brain request failed (${response.status})` }
    return
  }

  // Node's fetch body is a web ReadableStream; `Readable.fromWeb` gives a typed
  // async-iterable of chunks the frame parser consumes.
  for await (const frame of parseSseFrames(Readable.fromWeb(response.body))) {
    const brainEvent = mapFrameToBrainEvent(frame)
    if (brainEvent !== null) yield brainEvent
    // Done at the session's own end OR the transport terminal — whichever comes
    // first; the rest of the stream (a boundary context swap) is the server's.
    if (brainEvent?.kind === 'completed' || frame.event === 'turn-stream-ended') return
  }
  // The stream ended without an explicit terminal frame — treat as complete.
  yield { kind: 'completed' }
}

/** Build the driver's `runBrainTurn` bound to a local-api base URL. Voice turns
 *  run on the fast model with `voice: true` — the brain replies by calling the
 *  `speak` tool (which loops back to this daemon's speaker), not with prose. */
export function createBrainClient(
  apiUrl: string,
): (utterance: string) => AsyncIterable<VoiceBrainEvent> {
  return (utterance: string) =>
    streamTurnEvents(`${apiUrl}/root/turn`, {
      userMessageText: utterance,
      model: VOICE_MODEL,
      voice: true,
    })
}
