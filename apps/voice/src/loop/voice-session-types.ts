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

/** The brain's answer, reduced to what voice needs: text deltas, the notices the
 *  daemon speaks about while a turn is still in flight, and a terminal. The SSE
 *  brain client adapts the runner's `ChatTurnEvent` stream into this. */
export type VoiceBrainEvent =
  | { readonly kind: 'text'; readonly delta: string }
  /** The server parked this turn behind another on the same lock — the daemon
   *  says one short line so a queued turn doesn't read as being ignored. */
  | { readonly kind: 'queued' }
  /** A RECOVERABLE failure: the runner retries in place and a completion after
   *  it means the turn survived, so the daemon must not apologise for it. It
   *  never leaves the brain client — remembered there, and spoken as a `failed`
   *  only if the stream ends without the turn ever completing. */
  | { readonly kind: 'retrying'; readonly message: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly message: string }

/** The driver's outbound side — the audio shell implements it; tests fake it. */
export interface VoiceSessionIo {
  /** Announce a state change (status line / future overlay). */
  setState(state: VoiceSessionState): void
  /** Play a synthesized audio segment (through the speaker), in order. */
  emitAudio(audio: PcmAudio): void | Promise<void>
  /** All TTS for this turn has been sent — the shell calls `notifyPlaybackDrained()`
   *  once the speaker has actually finished, reopening the mic. The echo defense:
   *  the mic stays closed until playback truly ends, not merely until we stopped
   *  sending audio. */
  endSpeech(): void
  /** Discard everything queued on the speaker NOW (the barge-in cut — see
   *  output-sink.cutPlayback for the pairing contract). */
  cutPlayback(): void
}

/** The daemon↔overlay wake seam: when a browser Jarvis view is connected, the
 *  wake is PUBLISHED to it instead of running the native turn — local/private
 *  wake stays here, the accurate command session runs in the browser. */
export interface WakeHandoff {
  /** True when a connected overlay should own the command session. */
  shouldHandOff(): boolean
  /** Announce the wake; `command` is any same-breath text after the phrase ('' if bare). */
  publishWake(command: string): void
}

export interface VoiceSessionDriverDeps {
  readonly vad: VoiceActivityDetector
  readonly recognizer: SpeechRecognizer
  readonly synthesizer: VoiceEngine
  /** Run the brain on an utterance; yields the answer as text deltas + a
   *  terminal. `signal` aborts the READ when the watchdog fires — the server
   *  turn keeps running. */
  readonly runBrainTurn: (utterance: string, signal: AbortSignal) => AsyncIterable<VoiceBrainEvent>
  readonly io: VoiceSessionIo
  readonly wakeHandoff?: WakeHandoff
  /** Surface a swallowed speak/synth failure (silent otherwise — the queue keeps
   *  going). The shell logs it; tests omit it. */
  readonly onSpeakError?: (error: unknown, text: string) => void
  /** A turn outstayed the watchdog and the room was handed back. The shell logs
   *  it — a daemon that keeps doing this is a server-side park worth chasing. */
  readonly onTurnWatchdog?: (utterance: string) => void
}

export interface VoiceSessionDriverOptions {
  /** Silence (ms) in an active conversation before falling back asleep. */
  readonly idleTimeoutMs?: number
  /** How long a turn may hold the room before the watchdog hands it back.
   *  0 disables it (the pre-hardening unbounded wait). */
  readonly turnWatchdogMs?: number
  /** Speaker id for multi-voice models (e.g. Kokoro). */
  readonly voiceId?: number
}
