import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector, VoiceEngine } from '@vynel/voice-engine'
import { detectWakeWord, SpokenSentenceBuffer } from '@vynel/voice'
import type { VoiceBrainEvent, VoiceSessionIo } from './voice-session-types.js'

// The always-on voice loop, as a headless state machine. Mic PCM (16 kHz mono)
// flows in via `pushAudio`; the driver segments it (VAD), transcribes each
// segment, and runs a multi-turn conversation:
//
//   ASLEEP — every segment is checked for the wake phrase ("hey vynel"); nothing
//            else is acted on. On wake it becomes ACTIVE (and runs the command if
//            one followed the phrase in the same breath).
//   ACTIVE — a conversation window: every utterance is a command, no re-wake
//            needed. Each answer keeps it active; after `idleTimeoutMs` of no
//            command it falls back ASLEEP.
//   BUSY   — a turn is thinking/speaking; incoming audio is dropped (v1 has no
//            user barge-in), and the mic reopens only once the shell reports
//            playback drained (the echo defense).
//   HANDED-OFF — a connected browser overlay claimed the wake and owns the
//            command session (Web Speech STT + spoken reply run THERE). The
//            daemon ignores all audio — including its own speakers playing the
//            overlay's TTS — until `endHandoff()` returns it to ASLEEP.
//
// Every dependency is injected so the whole flow is unit-tested with fakes; the
// audio device + models + brain client are wired in the shell.

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
  /** Run the brain on an utterance; yields the answer as text deltas + a terminal. */
  readonly runBrainTurn: (utterance: string) => AsyncIterable<VoiceBrainEvent>
  readonly io: VoiceSessionIo
  readonly wakeHandoff?: WakeHandoff
}

export interface VoiceSessionDriverOptions {
  /** Silence (ms) in an active conversation before falling back asleep. */
  readonly idleTimeoutMs?: number
  /** Speaker id for multi-voice models (e.g. Kokoro). */
  readonly voiceId?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const FAILED_TURN_LINE = 'Sorry, I ran into a problem with that.'

type DriverState = 'asleep' | 'active' | 'busy' | 'handed-off'

export class VoiceSessionDriver {
  readonly #deps: VoiceSessionDriverDeps
  readonly #idleTimeoutMs: number
  readonly #voiceId: number | undefined

  #state: DriverState = 'asleep'
  #processing = false
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #resolvePlaybackDrained: (() => void) | null = null
  #playbackDrainedPending = false

  constructor(deps: VoiceSessionDriverDeps, options: VoiceSessionDriverOptions = {}) {
    this.#deps = deps
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.#voiceId = options.voiceId
  }

  /** Whether a conversation is currently active (awake). */
  get isAwake(): boolean {
    return this.#state !== 'asleep'
  }

  /** Feed a chunk of mic PCM (16 kHz mono). Ignored while a turn is in flight
   *  or while a browser overlay owns the session. */
  async pushAudio(audio: PcmAudio): Promise<void> {
    if (this.#state === 'busy' || this.#state === 'handed-off' || this.#processing) return
    this.#processing = true
    try {
      for (const segment of this.#deps.vad.push(audio)) {
        if (await this.#handleSegment(segment)) break
      }
    } finally {
      this.#processing = false
    }
  }

  /** The shell finished playing all queued TTS — safe to reopen the mic. */
  notifyPlaybackDrained(): void {
    if (this.#resolvePlaybackDrained !== null) {
      const resolve = this.#resolvePlaybackDrained
      this.#resolvePlaybackDrained = null
      resolve()
    } else {
      this.#playbackDrainedPending = true
    }
  }

  /** The overlay's command session ended (or its client disconnected) — the
   *  daemon takes the mic back and resumes wake-listening. */
  endHandoff(): void {
    if (this.#state !== 'handed-off') return
    this.#toAsleep()
  }

  /** Stop the driver — clears timers (call on shutdown). */
  stop(): void {
    this.#clearIdleTimer()
  }

  // Returns true if it ran a full turn (so the caller stops draining the batch).
  async #handleSegment(segment: PcmAudio): Promise<boolean> {
    const transcript = (await this.#deps.recognizer.transcribe(segment)).trim()

    if (this.#state === 'active') {
      // In a conversation, every real utterance is a command; ignore silence/noise.
      if (!transcript) return false
      await this.#runTurn(transcript)
      return true
    }

    // Asleep: only the wake phrase matters.
    const wake = detectWakeWord(transcript)
    if (!wake.detected) return false
    this.#deps.io.setState('wake')
    if (this.#deps.wakeHandoff?.shouldHandOff() === true) {
      this.#state = 'handed-off'
      this.#deps.wakeHandoff.publishWake(wake.command)
      return true
    }
    if (wake.command) {
      await this.#runTurn(wake.command)
      return true
    }
    // Bare "hey vynel" — wake and listen for the command.
    this.#goActive()
    return false
  }

  async #runTurn(utterance: string): Promise<void> {
    this.#clearIdleTimer()
    this.#state = 'busy'
    this.#deps.io.setState('thinking')

    const buffer = new SpokenSentenceBuffer()
    let spoke = false
    try {
      for await (const event of this.#deps.runBrainTurn(utterance)) {
        if (event.kind === 'text') {
          for (const sentence of buffer.push(event.delta)) spoke = (await this.#speak(sentence)) || spoke
        } else {
          for (const sentence of buffer.flush()) spoke = (await this.#speak(sentence)) || spoke
          if (event.kind === 'failed') spoke = (await this.#speak(FAILED_TURN_LINE)) || spoke
          break
        }
      }
    } catch {
      for (const sentence of buffer.flush()) spoke = (await this.#speak(sentence)) || spoke
      spoke = (await this.#speak(FAILED_TURN_LINE)) || spoke
    }

    if (spoke) {
      this.#deps.io.endSpeech()
      await this.#awaitPlaybackDrained()
    }
    // Stay in the conversation for follow-ups; silence eventually sleeps it.
    this.#goActive()
  }

  async #speak(text: string): Promise<boolean> {
    this.#deps.io.setState('speaking')
    const audio = await this.#deps.synthesizer.synthesize(
      text,
      this.#voiceId !== undefined ? { voiceId: this.#voiceId } : undefined,
    )
    await this.#deps.io.emitAudio(audio)
    return true
  }

  #awaitPlaybackDrained(): Promise<void> {
    if (this.#playbackDrainedPending) {
      this.#playbackDrainedPending = false
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.#resolvePlaybackDrained = resolve
    })
  }

  #goActive(): void {
    this.#state = 'active'
    this.#deps.io.setState('listening')
    this.#startIdleTimer()
  }

  #toAsleep(): void {
    this.#clearIdleTimer()
    this.#state = 'asleep'
    this.#deps.io.setState('idle')
  }

  #startIdleTimer(): void {
    this.#clearIdleTimer()
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null
      if (this.#state === 'active') this.#toAsleep()
    }, this.#idleTimeoutMs)
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
  }
}
