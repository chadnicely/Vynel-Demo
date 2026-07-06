import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector, VoiceEngine } from '@vynel/voice-engine'
import { detectWakeWord, SpokenSentenceBuffer } from '@vynel/voice'
import type { VoiceBrainEvent, VoiceSessionIo } from './voice-session-types.js'

// The always-on voice loop, as a headless state machine. Mic PCM (16 kHz mono)
// flows in via `pushAudio`; the driver segments it (VAD), transcribes each
// segment, matches the wake phrase, runs the brain, and speaks the answer
// sentence-by-sentence. Every dependency is injected so the whole flow is
// unit-tested with fakes — the WebSocket + real models are wired in the shell.
//
// Two designed-in contracts (see voice-relay-design + advisor):
//  • Echo defense — while the assistant speaks, the mic is closed and only
//    reopens once the CLIENT reports playback drained (not when the server
//    finished sending), so Vynel never transcribes its own voice.
//  • Wake-then-pause — "hey vynel" alone arrives as its own VAD segment; the
//    driver then treats the NEXT segment as the command (with a timeout).

export interface VoiceSessionDriverDeps {
  readonly vad: VoiceActivityDetector
  readonly recognizer: SpeechRecognizer
  readonly synthesizer: VoiceEngine
  /** Run the brain on an utterance; yields the answer as text deltas + a terminal. */
  readonly runBrainTurn: (utterance: string) => AsyncIterable<VoiceBrainEvent>
  readonly io: VoiceSessionIo
}

export interface VoiceSessionDriverOptions {
  /** How long to wait for the command after a bare "hey vynel" before giving up. */
  readonly commandTimeoutMs?: number
  /** Speaker id for multi-voice models (e.g. Kokoro). */
  readonly voiceId?: number
}

const DEFAULT_COMMAND_TIMEOUT_MS = 6000
const FAILED_TURN_LINE = 'Sorry, I ran into a problem with that.'

// `listening` + `waiting-for-command` are mic-open; `busy` (thinking/speaking/
// draining) drops incoming audio — v1 has no user barge-in.
type DriverState = 'listening' | 'waiting-for-command' | 'busy'

export class VoiceSessionDriver {
  readonly #deps: VoiceSessionDriverDeps
  readonly #commandTimeoutMs: number
  readonly #voiceId: number | undefined

  #state: DriverState = 'listening'
  #processing = false
  #commandTimer: ReturnType<typeof setTimeout> | null = null
  #resolvePlaybackDrained: (() => void) | null = null
  // Set when the client reports drained BEFORE the driver started waiting (a
  // real client can send it the instant its buffer empties) — the next wait
  // then resolves immediately instead of hanging.
  #playbackDrainedPending = false

  constructor(deps: VoiceSessionDriverDeps, options: VoiceSessionDriverOptions = {}) {
    this.#deps = deps
    this.#commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.#voiceId = options.voiceId
  }

  /** Feed a chunk of mic PCM (16 kHz mono). Ignored while a turn is in flight. */
  async pushAudio(audio: PcmAudio): Promise<void> {
    if (this.#state === 'busy' || this.#processing) return
    this.#processing = true
    try {
      for (const segment of this.#deps.vad.push(audio)) {
        // Once a turn ran, drop the rest of this batch — they're stale utterances
        // captured before/around it, and the mic was logically closed meanwhile.
        if (await this.#handleSegment(segment)) break
      }
    } finally {
      this.#processing = false
    }
  }

  /** The client finished playing all queued TTS — safe to reopen the mic. */
  notifyPlaybackDrained(): void {
    if (this.#resolvePlaybackDrained !== null) {
      const resolve = this.#resolvePlaybackDrained
      this.#resolvePlaybackDrained = null
      resolve()
    } else {
      this.#playbackDrainedPending = true
    }
  }

  // Returns true if it ran a full turn (so the caller stops draining the batch).
  async #handleSegment(segment: PcmAudio): Promise<boolean> {
    const transcript = (await this.#deps.recognizer.transcribe(segment)).trim()

    if (this.#state === 'waiting-for-command') {
      this.#clearCommandTimeout()
      if (transcript) {
        await this.#runTurn(transcript)
        return true
      }
      this.#toListening()
      return false
    }

    const wake = detectWakeWord(transcript)
    if (!wake.detected) return false
    if (wake.command) {
      await this.#runTurn(wake.command)
      return true
    }
    this.#state = 'waiting-for-command'
    this.#deps.io.setState('wake')
    this.#startCommandTimeout()
    return false
  }

  async #runTurn(utterance: string): Promise<void> {
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
    this.#toListening()
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

  #toListening(): void {
    this.#state = 'listening'
    this.#deps.io.setState('listening')
  }

  #startCommandTimeout(): void {
    this.#clearCommandTimeout()
    this.#commandTimer = setTimeout(() => {
      this.#commandTimer = null
      if (this.#state === 'waiting-for-command') this.#toListening()
    }, this.#commandTimeoutMs)
  }

  #clearCommandTimeout(): void {
    if (this.#commandTimer !== null) {
      clearTimeout(this.#commandTimer)
      this.#commandTimer = null
    }
  }
}
