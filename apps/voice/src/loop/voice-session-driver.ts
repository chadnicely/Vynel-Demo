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
  /** Surface a swallowed speak/synth failure (silent otherwise — the queue keeps
   *  going). The shell logs it; tests omit it. */
  readonly onSpeakError?: (error: unknown, text: string) => void
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
  // External `speak` text (the `speak` tool / proactive lines), drained even
  // while handed off (the daemon speaker is free; the browser owns the mic).
  #speakQueue: string[] = []
  #drainingSpeakQueue = false
  // The state a drain interrupted, restored when it finishes; and a handoff-end
  // that arrived MID-drain (state forced 'busy' then, so endHandoff couldn't act)
  // — honored by the drain's finally so it isn't swallowed (deaf-daemon bug).
  #drainPriorState: DriverState | null = null
  #endHandoffPending = false

  constructor(deps: VoiceSessionDriverDeps, options: VoiceSessionDriverOptions = {}) {
    this.#deps = deps
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.#voiceId = options.voiceId
  }

  /** Whether a conversation is currently active (awake). */
  get isAwake(): boolean {
    return this.#state !== 'asleep'
  }

  /** True while a browser overlay owns the command session — its own turn
   *  stream plays every `speak` there, so the daemon must not re-route one. */
  get isHandedOff(): boolean {
    return this.#state === 'handed-off' || this.#drainPriorState === 'handed-off'
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
      // A turn/segment just finished — the audio path may now be free for a
      // speak that was queued while it ran.
      this.#kickSpeakQueue()
    }
  }

  /** Enqueue external text to speak — the `speak` MCP tool (any session) or a
   *  proactive notification. Returns immediately once ACCEPTED; the queue drains
   *  when the driver is free (not mid-turn, not handed off to a browser overlay),
   *  so a proactive line never collides with a live conversation or defeats the
   *  echo defense. Lines speak in order; a failure on one never strands the rest.
   *  It does not run the brain — the caller supplies the exact words. */
  speak(text: string): void {
    const spoken = text.trim()
    if (spoken !== '') this.#speakQueue.push(spoken)
    this.#kickSpeakQueue()
  }

  // Start draining if there's text AND the speaker is free. A no-op while the
  // daemon's OWN turn/segment owns the audio path — the next free transition
  // (pushAudio's finally) re-kicks. Speaks freely while 'handed-off': the browser
  // overlay owns the MIC, but the daemon speaker is idle and the `speak` tool is
  // exactly how the overlay's brain turn talks. Never starts a second drain.
  #kickSpeakQueue(): void {
    if (this.#drainingSpeakQueue || this.#speakQueue.length === 0) return
    if (this.#state === 'busy' || this.#processing) return
    void this.#drainSpeakQueue()
  }

  async #drainSpeakQueue(): Promise<void> {
    this.#drainingSpeakQueue = true
    // Restore EXACTLY where we were afterward — a proactive line must not wake a
    // sleeping daemon into a conversation, nor yank a handoff away from the
    // browser overlay. Only 'busy' can't be the prior state — the kick guard
    // blocks it. Tracked in a field so a mid-drain endHandoff can see it.
    this.#drainPriorState = this.#state
    this.#clearIdleTimer()
    this.#state = 'busy' // drop mic frames while speaking (echo defense)
    try {
      while (this.#speakQueue.length > 0) {
        const text = this.#speakQueue.shift()!
        try {
          await this.#speakLine(text)
        } catch (error) {
          // A TTS/audio hiccup on one line must never strand the queue or the
          // state machine — drop it, speak the next; the finally restores state.
          this.#deps.onSpeakError?.(error, text)
        }
      }
    } finally {
      const priorState = this.#drainPriorState
      this.#drainPriorState = null
      this.#drainingSpeakQueue = false
      if (this.#endHandoffPending) {
        // The overlay released the handoff WHILE we were speaking — honor it now
        // (the guard on endHandoff couldn't, state was 'busy'). Else it'd be lost.
        this.#endHandoffPending = false
        this.#toAsleep()
      } else if (priorState === 'asleep') {
        this.#toAsleep()
      } else if (priorState === 'handed-off') {
        this.#state = 'handed-off'
        // Signal the overlay the daemon speaker is free again (it gated its mic
        // on this) — the state stays handed-off; this is the outbound signal only.
        this.#deps.io.setState('idle')
      } else {
        this.#goActive()
      }
    }
  }

  async #speakLine(text: string): Promise<void> {
    const buffer = new SpokenSentenceBuffer()
    let spoke = false
    for (const sentence of buffer.push(text)) spoke = (await this.#speak(sentence)) || spoke
    for (const sentence of buffer.flush()) spoke = (await this.#speak(sentence)) || spoke
    if (spoke) {
      this.#deps.io.endSpeech()
      await this.#awaitPlaybackDrained()
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
    if (this.#state === 'handed-off') {
      this.#toAsleep()
      // The overlay released the audio path — a speak queued during the handoff
      // can play now.
      this.#kickSpeakQueue()
      return
    }
    // A speak is draining on TOP of the handoff (state forced 'busy'), so we
    // can't act yet — record it so the drain's finally returns to sleep instead
    // of restoring the handoff and leaving the daemon deaf with no owner.
    if (this.#drainingSpeakQueue && this.#drainPriorState === 'handed-off') {
      this.#endHandoffPending = true
    }
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

    // The daemon no longer speaks the reply text — the brain replies by CALLING
    // the `speak` tool, which loops back to this driver's speaker (queued behind
    // this turn, played once it frees). We just run the turn to completion.
    let failed = false
    try {
      for await (const event of this.#deps.runBrainTurn(utterance)) {
        if (event.kind === 'failed') {
          failed = true
          break
        }
        if (event.kind === 'completed') break
        // 'text' deltas are ignored — voice output is the `speak` tool alone.
      }
    } catch {
      failed = true
    }

    // A failed turn won't have called `speak` — say so, queued like any speak
    // (drained after we free this turn).
    if (failed) this.speak(FAILED_TURN_LINE)
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
