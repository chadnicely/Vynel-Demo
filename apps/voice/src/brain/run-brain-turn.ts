import { Readable } from 'node:stream'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import { parseSseFrames, type SseFrame } from './sse-frames.js'

// The brain client: POST an utterance to local-api's `/root/turn` and stream the
// answer back as `VoiceBrainEvent`s (the driver's `runBrainTurn`). The SSE frames
// carry the full `ChatTurnEvent` union; voice only needs the text + the terminal.

/** Map one SSE frame to a `VoiceBrainEvent`, or null for frames voice ignores
 *  (thinking, tool calls, approvals, usage). Pure — unit-tested. */
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

/** Build the driver's `runBrainTurn` bound to a local-api base URL. */
export function createBrainClient(
  apiUrl: string,
): (utterance: string) => AsyncIterable<VoiceBrainEvent> {
  return async function* runBrainTurn(utterance: string): AsyncIterable<VoiceBrainEvent> {
    let response: Response
    try {
      response = await fetch(`${apiUrl}/root/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ userMessageText: utterance }),
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
      if (frame.event === 'turn-stream-ended') return
    }
    // The stream ended without an explicit terminal frame — treat as complete.
    yield { kind: 'completed' }
  }
}
