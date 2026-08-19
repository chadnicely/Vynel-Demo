import type { PcmAudio } from '@vynel/voice-engine'
import { detectWakeWord, LineSpeaker } from '@vynel/voice'
import { armTurnWatchdog } from './turn-watchdog.js'
import type { VoiceSessionDriverDeps, VoiceSessionDriverOptions } from './voice-session-types.js'

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
//            playback drained (the echo defense). A turn that outstays the
//            per-turn WATCHDOG hands the room back early: the driver says so,
//            returns to ACTIVE and stops reading, while the server turn runs on
//            and speaks its answer through the `speak` queue like any other.
//   HANDED-OFF — a connected browser overlay claimed the wake and owns the
//            command session (Web Speech STT + spoken reply run THERE). The
//            daemon ignores all audio — including its own speakers playing the
//            overlay's TTS — until `endHandoff()` returns it to ASLEEP.
//
// Every dependency is injected so the whole flow is unit-tested with fakes; the
// audio device + models + brain client are wired in the shell.

const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_TURN_WATCHDOG_MS = 300_000
const FAILED_TURN_LINE = 'Sorry, I ran into a problem with that.'
const STILL_WORKING_LINE = "Still working on that — I'll tell you when it's done."
const QUEUED_TURN_LINE = 'One moment.'

type DriverState = 'asleep' | 'active' | 'busy' | 'handed-off'

export class VoiceSessionDriver {
  readonly #deps: VoiceSessionDriverDeps
  readonly #idleTimeoutMs: number
  readonly #turnWatchdogMs: number
  readonly #voiceId: number | undefined

  #state: DriverState = 'asleep'
  #processing = false
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  // The line mechanics (sentence pipelining, drain waits, the cancel contract)
  // live in the shared LineSpeaker home; the driver owns queueing + states.
  readonly #lineSpeaker: LineSpeaker
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
    this.#turnWatchdogMs = options.turnWatchdogMs ?? DEFAULT_TURN_WATCHDOG_MS
    this.#voiceId = options.voiceId
    this.#lineSpeaker = new LineSpeaker({
      synthesize: (sentence) =>
        deps.synthesizer.synthesize(
          sentence,
          this.#voiceId !== undefined ? { voiceId: this.#voiceId } : undefined,
        ),
      emitAudio: (audio) => deps.io.emitAudio(audio),
      endSpeech: () => deps.io.endSpeech(),
      cutPlayback: () => deps.io.cutPlayback(),
    })
  }

  /** Whether a conversation is currently active (awake). */
  get isAwake(): boolean {
    return this.#state !== 'asleep'
  }

  /** True while a browser overlay owns the command session. The shell routes
   *  `speak` on it: the overlay has the room, so a spoken line belongs THERE
   *  (main.ts), not on the daemon's own speaker underneath it. */
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

  /** Speak a short line WHILE a turn still owns the room (the queued sentinel).
   *  The ordinary kick refuses while a turn holds the audio path; here the turn
   *  is parked SERVER-side, so the speaker is genuinely free — and the drain
   *  keeps the mic closed and restores 'busy' when it finishes. */
  #speakTurnNotice(text: string): void {
    this.#speakQueue.push(text)
    if (!this.#drainingSpeakQueue) void this.#drainSpeakQueue()
  }

  async #drainSpeakQueue(): Promise<void> {
    this.#drainingSpeakQueue = true
    // Restore EXACTLY where we were afterward — a proactive line must not wake a
    // sleeping daemon into a conversation, yank a handoff away from the browser
    // overlay, or reopen the mic under a live turn (the queued-notice case,
    // where 'busy' IS the prior state). Tracked in a field so a mid-drain
    // endHandoff — or a turn that ends mid-notice — can retarget it.
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
      } else if (priorState === 'busy') {
        // A turn was STILL running when this notice played — stay busy: handing
        // the mic back under a live turn breaks the echo defense and takes an
        // utterance the turn cannot answer. (The turn's own end retargets this
        // to 'active' if it finishes mid-notice.)
        this.#state = 'busy'
        this.#deps.io.setState('thinking')
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
    this.#deps.io.setState('speaking')
    await this.#lineSpeaker.speakLine(text)
  }

  /** The shell finished playing all queued TTS — safe to reopen the mic. */
  notifyPlaybackDrained(): void {
    this.#lineSpeaker.notifyPlaybackDrained()
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
    // this turn, played once it frees). We just run the turn to completion — or
    // until the watchdog decides the room has waited long enough.
    const watchdog = armTurnWatchdog(this.#turnWatchdogMs)
    let failed = false
    try {
      await Promise.race([
        this.#consumeBrainTurn(utterance, watchdog.signal).then((turnFailed) => {
          failed = turnFailed
        }),
        watchdog.whenExpired,
      ])
    } finally {
      watchdog.disarm()
    }

    if (watchdog.expired) {
      // The turn outstayed us. Hand the room back FIRST (the notice then drains
      // through the ordinary queue, which closes the mic while it plays), and
      // leave the server turn alone: its answer arrives through `speak` like any
      // other session's, and a `failed` from the abandoned read is not ours.
      this.#deps.onTurnWatchdog?.(utterance)
      this.#leaveTurn()
      this.speak(STILL_WORKING_LINE)
      return
    }

    // A failed turn won't have called `speak` — say so, queued like any speak
    // (drained after we free this turn).
    this.#leaveTurn()
    if (failed) this.speak(FAILED_TURN_LINE)
  }

  /** Drain the brain stream; true when the turn failed. Never throws — the
   *  watchdog races this, so a rejection would land unhandled. */
  async #consumeBrainTurn(utterance: string, signal: AbortSignal): Promise<boolean> {
    let announcedQueue = false
    try {
      for await (const event of this.#deps.runBrainTurn(utterance, signal)) {
        if (event.kind === 'failed') return true
        if (event.kind === 'completed') return false
        if (event.kind === 'queued' && !announcedQueue) {
          // ONE line per turn, however many sentinels the server sends (a queued
          // turn can also be parked again by a context swap).
          announcedQueue = true
          this.#speakTurnNotice(QUEUED_TURN_LINE)
        }
        // 'text' deltas are ignored — voice output is the `speak` tool alone.
      }
    } catch {
      return true
    }
    return false
  }

  /** Leave the turn's BUSY state and stay in the conversation for follow-ups;
   *  silence eventually sleeps it. A notice may still be draining (the queued
   *  sentinel) — then the drain owns the state and only its restore target
   *  moves, because touching it here would reopen the mic under live audio. */
  #leaveTurn(): void {
    if (this.#drainingSpeakQueue) this.#drainPriorState = 'active'
    else this.#goActive()
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
