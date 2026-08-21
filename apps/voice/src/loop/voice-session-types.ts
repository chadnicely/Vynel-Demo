import type { Logger } from 'pino'
import type {
  PcmAudio,
  SpeechRecognizer,
  VoiceActivityDetector,
  VoiceEngine,
} from '@vynel/voice-engine'

// The seams the voice loop is built on. Kept as injected interfaces so the
// driver's state machine is unit-tested with fakes — no models, no audio device.

/** The loop's outward-facing state — for a status line / tray / future overlay.
 *  `idle` = asleep (wake-word only); `listening` = an active conversation. */
export type VoiceSessionState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking'

/** The brain's answer, reduced to what voice needs: the session it runs on,
 *  text deltas, the in-flight notices, and a terminal. The SSE brain client
 *  adapts the runner's `ChatTurnEvent` stream into this. */
export type VoiceBrainEvent =
  /** The turn's session is known — the barge-in interrupt names it. Arrives
   *  as early as the server persists the user message; repeated on a context
   *  swap (the fresh segment). */
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'text'; readonly delta: string }
  /** The server parked this turn behind another on the same lock. Nothing is
   *  spoken about it (voice-realtime VR3) — the model's first sentence is the
   *  acknowledgment when it comes. */
  | { readonly kind: 'queued' }
  /** A RECOVERABLE failure: the runner retries in place and a completion after
   *  it means the turn survived, so the daemon must not apologise for it. It
   *  never leaves the brain client — remembered there, and spoken as a `failed`
   *  only if the stream ends without the turn ever completing. */
  | { readonly kind: 'retrying'; readonly message: string }
  | { readonly kind: 'completed' }
  /** Someone stopped the turn server-side (a Stop control, a barge-in). Not a
   *  failure: nothing to apologise for. */
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'failed'; readonly message: string }

/** The daemon's door to local-api's voice thread. */
export interface VoiceBrainClient {
  /** Run the brain on an utterance; yields the answer as text deltas + a
   *  terminal. `signal` stops READING (a barge-in) — the server turn is
   *  stopped separately, through `interruptTurn`. */
  runTurn(utterance: string, signal?: AbortSignal): AsyncIterable<VoiceBrainEvent>
  /** Stop OUR running server turn (the user moved on). Resolves with whether
   *  the server found a turn to interrupt; rejects on a transport/HTTP failure
   *  (the caller logs — never fatal to the conversation). */
  interruptTurn(sessionId: string): Promise<boolean>
}

/** The driver's outbound side — the audio shell implements it; tests fake it. */
export interface VoiceSessionIo {
  /** Announce a state change (status line / future overlay). */
  setState(state: VoiceSessionState): void
  /** Play a synthesized audio segment (through the speaker), in order. */
  emitAudio(audio: PcmAudio): void | Promise<void>
  /** All TTS for this line has been sent — the shell calls `notifyPlaybackDrained()`
   *  once the speaker has actually finished. The echo filter keeps a spoken
   *  line hearable until then (plus the speaker→mic return window). */
  endSpeech(): void
  /** Discard everything queued on the speaker NOW (the barge-in cut — see
   *  output-sink.cutPlayback for the pairing contract). */
  cutPlayback(): void
}

/** The daemon↔overlay wake seam: when a browser voice view is connected, the
 *  wake is PUBLISHED to it instead of running the native turn — local/private
 *  wake stays here, the accurate command session runs in the browser. */
export interface WakeHandoff {
  /** True when a connected overlay should own the command session. */
  shouldHandOff(): boolean
  /** Announce the wake; `command` is any same-breath text after the phrase ('' if bare). */
  publishWake(command: string): void
}

export interface VoiceSessionDriverDeps {
  readonly logger: Logger
  readonly vad: VoiceActivityDetector
  readonly recognizer: SpeechRecognizer
  readonly synthesizer: VoiceEngine
  readonly brain: VoiceBrainClient
  readonly io: VoiceSessionIo
  readonly wakeHandoff?: WakeHandoff
  /** Surface a swallowed speak/synth failure (silent otherwise — the queue keeps
   *  going). The shell logs it; tests omit it. */
  readonly onSpeakError?: (error: unknown, text: string) => void
  /** A turn stayed silent past the watchdog and the room was handed back. The
   *  shell logs it — a daemon that keeps doing this is a server-side park worth
   *  chasing. */
  readonly onTurnWatchdog?: (utterance: string) => void
}

export interface VoiceSessionDriverOptions {
  /** Silence (ms) in an active conversation before falling back asleep. */
  readonly idleTimeoutMs?: number
  /** How long a turn may stay SILENT (no text yet) before the watchdog hands
   *  the room back. 0 disables it (the pre-hardening unbounded wait). */
  readonly turnWatchdogMs?: number
  /** Speaker id for multi-voice models (e.g. Kokoro). */
  readonly voiceId?: number
}
