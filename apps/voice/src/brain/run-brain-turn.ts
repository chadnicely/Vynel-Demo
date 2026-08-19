import { Readable } from 'node:stream'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import { parseSseFrames, type SseFrame } from '@vynel/sdk'

// The brain client: POST an utterance to local-api's `/root/turn` and stream the
// answer back as `VoiceBrainEvent`s (the driver's `runBrainTurn`). The SSE frames
// carry the full `ChatTurnEvent` union; voice only needs the text, the two
// in-flight notices it speaks about, and the terminal.

/** Map one SSE frame to a `VoiceBrainEvent`, or null for frames voice ignores
 *  (thinking, tool calls, approvals, usage, the context-swap frames). Pure —
 *  unit-tested.
 *
 *  The transport terminal (`turn-stream-ended`) is deliberately NOT mapped here:
 *  it carries no payload and says only that the socket is over. Whether that
 *  means "completed" depends on what came before it, so `streamTurnEvents` owns
 *  that call — one home for the decision. */
export function mapFrameToBrainEvent(frame: SseFrame): VoiceBrainEvent | null {
  // The queued sentinel is a bare `{ reason }` with no `kind` — the SSE event
  // NAME is the only discriminator, exactly like the transport terminal. Both
  // reasons (`busy` behind another turn, `context-patching` mid-swap) mean the
  // same thing to a listener: wait a moment.
  if (frame.event === 'turn-queued') return { kind: 'queued' }

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
    const message = typeof event.errorMessage === 'string' ? event.errorMessage : 'the turn failed'
    // A RECOVERABLE error is not the turn's ending — the runner retries in place
    // and "a recoverable error followed by completion is a completed turn"
    // (`run-turn-with-continuations`), which is why `!isRecoverable` is what
    // makes a turn `failed` on every other surface. The daemon used to apologise
    // out loud for a blip the server recovered from. Only an explicit `true` is
    // transient: a missing flag stays a failure.
    return event.isRecoverable === true ? { kind: 'retrying', message } : { kind: 'failed', message }
  }
  if (event.kind === 'session-interrupted') {
    return { kind: 'failed', message: 'the turn was interrupted' }
  }
  return null
}

// The voice tier lives in ONE home — `@vynel/contracts` voice-tier.ts (the
// panel's composer defaults + the overlay leg read the same constants).
import {
  VOICE_TIER_MODE as VOICE_MODE,
  VOICE_TIER_MODEL as VOICE_MODEL,
  VOICE_TIER_THINKING_EFFORT as VOICE_THINKING_EFFORT,
} from '@vynel/contracts/chat/voice-tier'
export { VOICE_MODE, VOICE_MODEL, VOICE_THINKING_EFFORT }

/** How long to wait for the response HEADERS before giving up on the brain. A
 *  refused connection already fails fast; this bounds a server that ACCEPTS the
 *  socket and then never answers — without it the daemon sat deaf on a hung
 *  fetch forever. Generous enough that a busy-but-alive api still gets through:
 *  the stream's own headers go out before any queueing happens server-side. */
const CONNECT_TIMEOUT_MS = 10_000

export interface StreamTurnOptions {
  /** Stop READING this turn (the daemon's per-turn watchdog). The server turn
   *  keeps running — aborting only frees this socket; its answer still arrives
   *  through the `speak` door. */
  readonly signal?: AbortSignal
  readonly connectTimeoutMs?: number
}

/** POST a turn request and stream the reply as `VoiceBrainEvent`s — the ONE
 *  home for the SSE turn wire; the wake line (`/root/turn`) and the call
 *  session client (`/sessions/:id/turn`) differ only in URL and body. */
export async function* streamTurnEvents(
  url: string,
  body: Record<string, unknown>,
  options: StreamTurnOptions = {},
): AsyncIterable<VoiceBrainEvent> {
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (options.signal?.aborted === true) abortFromCaller()

  let connectTimedOut = false
  const connectTimer = setTimeout(() => {
    connectTimedOut = true
    controller.abort(new Error('connect deadline'))
  }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS)
  connectTimer.unref?.()

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (options.signal?.aborted === true) return
      yield {
        kind: 'failed',
        message: connectTimedOut
          ? `the brain did not answer within ${Math.round((options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS) / 1000)}s`
          : error instanceof Error
            ? error.message
            : 'brain unreachable',
      }
      return
    } finally {
      clearTimeout(connectTimer)
    }

    if (!response.ok || response.body === null) {
      yield { kind: 'failed', message: `brain request failed (${response.status})` }
      return
    }

    // A recoverable error the turn never recovered from: remembered rather than
    // spoken, and only becomes the ending if nothing completes after it (else a
    // dead engine answers a spoken question with silence).
    let recoverableFailure: string | null = null
    try {
      // Node's fetch body is a web ReadableStream; `Readable.fromWeb` gives a
      // typed async-iterable of chunks the frame parser consumes.
      for await (const frame of parseSseFrames(Readable.fromWeb(response.body))) {
        // The transport terminal — the session's own ending (below) is what
        // decides the turn; reaching this first means it never completed.
        if (frame.event === 'turn-stream-ended') break
        const brainEvent = mapFrameToBrainEvent(frame)
        if (brainEvent === null) continue
        if (brainEvent.kind === 'retrying') {
          recoverableFailure = brainEvent.message
          continue
        }
        yield brainEvent
        // Done at the session's own end: the answer is fully spoken by then and
        // the rest of the stream (a boundary context swap, which can take tens
        // of seconds) is the server's business. Voice turns run
        // `autoContinue: false`, so nothing else speaks after this.
        if (brainEvent.kind === 'completed') return
      }
    } catch (error) {
      // The watchdog stopped this read — the SERVER turn is still running and
      // has already been announced to the room. Not a failure to speak.
      if (controller.signal.aborted) return
      yield {
        kind: 'failed',
        message: error instanceof Error ? error.message : 'the brain stream broke',
      }
      return
    }

    yield recoverableFailure !== null
      ? { kind: 'failed', message: recoverableFailure }
      : { kind: 'completed' }
  } finally {
    clearTimeout(connectTimer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

/** Build the driver's `runBrainTurn` bound to a local-api base URL. Voice turns
 *  run the VOICE TIER on every leg (`voice: true` makes the server enforce it
 *  anyway — sending it keeps the daemon honest about what it asked for) and the
 *  brain replies by calling the `speak` tool, not with prose. */
export function createBrainClient(
  apiUrl: string,
): (utterance: string, signal?: AbortSignal) => AsyncIterable<VoiceBrainEvent> {
  return (utterance: string, signal?: AbortSignal) =>
    streamTurnEvents(
      `${apiUrl}/root/turn`,
      {
        userMessageText: utterance,
        model: VOICE_MODEL,
        thinkingEffort: VOICE_THINKING_EFFORT,
        mode: VOICE_MODE,
        voice: true,
      },
      signal !== undefined ? { signal } : {},
    )
}
