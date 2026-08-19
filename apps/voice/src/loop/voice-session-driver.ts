import type { PcmAudio } from '@vynel/voice-engine'
import { detectWakeWord } from '@vynel/voice'
import { DaemonSpeaker } from './daemon-speaker.js'
import { SpokenBrainTurn, type SpokenTurnOutcome } from './spoken-brain-turn.js'
import type { VoiceSessionDriverDeps, VoiceSessionDriverOptions } from './voice-session-types.js'

// The always-on voice loop, as a headless state machine. Mic PCM (16 kHz mono)
// flows in via `pushAudio`; the driver segments it (VAD), transcribes each
// segment, runs every transcript through the ECHO FILTER (our own voice coming
// back off the speaker is ignored; anything else is a person), and runs a
// multi-turn conversation:
//
//   ASLEEP   — every segment is checked for the wake phrase ("hey vynel");
//              nothing else is acted on. On wake it becomes ACTIVE (and runs the
//              command if one followed the phrase in the same breath).
//   ACTIVE   — a conversation window: every utterance is a command, no re-wake
//              needed. Each answer keeps it active; after `idleTimeoutMs` of no
//              command it falls back ASLEEP.
//   IN-TURN  — a turn is in flight: thinking, then SPEAKING its streamed text
//              (voice-realtime VR1). The mic stays OPEN: a real utterance is a
//              BARGE-IN (VR2) — playback is cut, the server turn interrupted,
//              and the utterance runs as the next turn. The turn ends → ACTIVE.
//              A turn that stays SILENT past the WATCHDOG hands the room back
//              early (→ ACTIVE, one honesty line) but keeps streaming in the
//              background — its late answer is still spoken when it lands.
//   RELAYING — an external line is playing (the `speak` tool from another
//              session, the watchdog/failure lines). The mic is closed for it
//              and the prior state restored after — a proactive line never
//              opens a conversation or takes an utterance it cannot answer.
//   HANDED-OFF — a connected browser overlay claimed the wake and owns the
//              command session (Web Speech STT + spoken reply run THERE). The
//              daemon ignores all audio until `endHandoff()` returns it to ASLEEP.
//
// Every dependency is injected so the whole flow is unit-tested with fakes; the
// audio device + models + brain client are wired in the shell.

const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_TURN_WATCHDOG_MS = 300_000
const FAILED_TURN_LINE = 'Sorry, I ran into a problem with that.'
const STILL_WORKING_LINE = "Still working on that — I'll tell you when it's done."

type DriverState = 'asleep' | 'active' | 'in-turn' | 'relaying' | 'handed-off'

export class VoiceSessionDriver {
  readonly #deps: VoiceSessionDriverDeps
  readonly #idleTimeoutMs: number
  readonly #turnWatchdogMs: number

  #state: DriverState = 'asleep'
  #processing = false
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  // The speaking mechanics (pipelining, the lane, the echo memory) live in the
  // DaemonSpeaker; the driver owns queueing + states.
  readonly #speaker: DaemonSpeaker
  // Our server turn that may still be running — it owns the room while the
  // state is 'in-turn'; after the watchdog it runs on in the background. A
  // new utterance barges in on it either way.
  #runningTurn: SpokenBrainTurn | null = null
  // External `speak` text (the `speak` tool / proactive lines), drained even
  // while handed off (the daemon speaker is free; the browser owns the mic).
  #speakQueue: string[] = []
  #drainingSpeakQueue = false
  // The state a drain interrupted, restored when it finishes; and a handoff-end
  // that arrived MID-drain (state forced 'relaying' then, so endHandoff
  // couldn't act) — honored by the drain's finally so it isn't swallowed.
  #drainPriorState: DriverState | null = null
  #endHandoffPending = false

  constructor(deps: VoiceSessionDriverDeps, options: VoiceSessionDriverOptions = {}) {
    this.#deps = deps
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.#turnWatchdogMs = options.turnWatchdogMs ?? DEFAULT_TURN_WATCHDOG_MS
    this.#speaker = new DaemonSpeaker(deps.synthesizer, deps.io, options.voiceId)
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

  /** Feed a chunk of mic PCM (16 kHz mono). Ignored while an external line
   *  plays or while a browser overlay owns the session — never while our own
   *  turn speaks (that is what the echo filter is for). */
  async pushAudio(audio: PcmAudio): Promise<void> {
    if (this.#state === 'relaying' || this.#state === 'handed-off' || this.#processing) return
    this.#processing = true
    try {
      for (const segment of this.#deps.vad.push(audio)) await this.#handleSegment(segment)
    } finally {
      this.#processing = false
      // A segment just finished — the audio path may now be free for a speak
      // that was queued while it ran.
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

  // Start draining if there's text AND the room is free. A no-op while a turn
  // owns the room or a segment is being handled — the next free transition
  // re-kicks. Speaks freely while 'handed-off': the browser overlay owns the
  // MIC, but the daemon speaker is idle and another session's `speak` line
  // (typed chat, a schedule) still has to be heard. Never starts a second drain.
  #kickSpeakQueue(): void {
    if (this.#drainingSpeakQueue || this.#speakQueue.length === 0) return
    if (this.#state === 'in-turn' || this.#state === 'relaying' || this.#processing) return
    void this.#drainSpeakQueue()
  }

  async #drainSpeakQueue(): Promise<void> {
    this.#drainingSpeakQueue = true
    // Restore EXACTLY where we were afterward — a proactive line must not wake a
    // sleeping daemon into a conversation or yank a handoff away from the
    // browser overlay. Tracked in a field so a mid-drain endHandoff — or a
    // background turn that ends mid-line — can retarget it.
    this.#drainPriorState = this.#state
    this.#clearIdleTimer()
    this.#state = 'relaying'
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
        // (the guard on endHandoff couldn't, state was 'relaying'). Else it'd be lost.
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
    this.#deps.io.setState('speaking')
    await this.#speaker.speakLine(text)
  }

  /** The shell finished playing all queued TTS. */
  notifyPlaybackDrained(): void {
    this.#speaker.notifyPlaybackDrained()
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
    // A speak is draining on TOP of the handoff (state forced 'relaying'), so
    // we can't act yet — record it so the drain's finally returns to sleep
    // instead of restoring the handoff and leaving the daemon deaf with no owner.
    if (this.#drainingSpeakQueue && this.#drainPriorState === 'handed-off') {
      this.#endHandoffPending = true
    }
  }

  /** Stop the driver — clears timers (call on shutdown). */
  stop(): void {
    this.#clearIdleTimer()
  }

  async #handleSegment(segment: PcmAudio): Promise<void> {
    const transcript = (await this.#deps.recognizer.transcribe(segment)).trim()
    if (!transcript) return
    if (this.#speaker.echoFilter.isEcho(transcript)) {
      this.#deps.logger.debug({ transcript }, 'ignoring an echo of our own voice')
      return
    }
    if (this.#state !== 'asleep') {
      // In a conversation every real utterance is the user — a command, or a
      // barge-in on the turn that is running.
      this.#startTurn(transcript)
      return
    }
    const wake = detectWakeWord(transcript)
    if (!wake.detected) return
    this.#deps.io.setState('wake')
    if (this.#deps.wakeHandoff?.shouldHandOff() === true) {
      void this.#abandonRunningTurn()
      this.#state = 'handed-off'
      this.#deps.wakeHandoff.publishWake(wake.command)
      return
    }
    if (wake.command) {
      this.#startTurn(wake.command)
      return
    }
    // Bare "hey vynel" — the user wants the room (even over a late answer
    // still playing); wake and listen for the command.
    void this.#abandonRunningTurn()
    this.#goActive()
  }

  #startTurn(utterance: string): void {
    this.#runTurn(utterance).catch((error: unknown) => {
      this.#deps.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'voice turn crashed — the room is handed back',
      )
      this.#runningTurn = null
      this.#leaveTurn()
    })
  }

  async #runTurn(utterance: string): Promise<void> {
    const previous = this.#runningTurn
    const turn = new SpokenBrainTurn({
      logger: this.#deps.logger,
      brain: this.#deps.brain,
      echoFilter: this.#speaker.echoFilter,
      turnWatchdogMs: this.#turnWatchdogMs,
      openSpeech: () => this.#speaker.openStreamedLine(),
      // A LATE answer (the watchdog already handed the room back) is still
      // speech: without this the status reads 'listening' through the whole
      // reply. A relay drain owns its own status — never overwrite it.
      onSpeaking: () => {
        if (this.#runningTurn === turn && this.#state !== 'relaying') this.#deps.io.setState('speaking')
      },
    })
    this.#runningTurn = turn
    this.#clearIdleTimer()
    this.#state = 'in-turn'
    this.#deps.io.setState('thinking')
    // The user moved on: cut + stop the previous turn BEFORE this one is sent,
    // so it is neither queued behind a turn about to die nor hit by a stop
    // that lands late on the shared session.
    if (previous !== null) await previous.bargeIn()
    if (this.#runningTurn !== turn) return

    const settled = turn.run(utterance)
    const first = await Promise.race([
      settled.then((outcome) => ({ kind: 'settled' as const, outcome })),
      turn.whenWatchdogFired.then(() => ({ kind: 'watchdog' as const })),
    ])
    // Superseded by a barge-in — the newer turn owns the room now.
    if (this.#runningTurn !== turn) return
    if (first.kind === 'watchdog') {
      // Silent too long: hand the room back and say so ONCE if the room has
      // heard nothing; the turn runs on and speaks its answer when it lands.
      this.#deps.onTurnWatchdog?.(utterance)
      this.#leaveTurn()
      if (!turn.hasSpoken) this.speak(STILL_WORKING_LINE)
      // Safe detached: run() never rejects, so a crash still arrives as an
      // outcome and the room comes back the same way any failure brings it.
      void settled.then((outcome) => this.#settleBackgroundTurn(turn, outcome))
      return
    }
    this.#runningTurn = null
    this.#leaveTurn()
    if (first.outcome === 'failed') this.speak(FAILED_TURN_LINE)
  }

  // A turn the watchdog released ended in the background: its late answer just
  // played (or it failed — say so, as for any turn) — forget it, and give the
  // conversation window back. Never reached while a newer turn or a handoff
  // owns the room: both abandon the old turn first.
  #settleBackgroundTurn(turn: SpokenBrainTurn, outcome: SpokenTurnOutcome): void {
    if (this.#runningTurn !== turn) return
    this.#runningTurn = null
    this.#leaveTurn()
    if (outcome === 'failed') this.speak(FAILED_TURN_LINE)
  }

  #abandonRunningTurn(): Promise<void> {
    const turn = this.#runningTurn
    this.#runningTurn = null
    return turn?.bargeIn() ?? Promise.resolve()
  }

  /** Leave the turn's state and stay in the conversation for follow-ups;
   *  silence eventually sleeps it. A relay line may be draining — then the
   *  drain owns the state and only its restore target moves, because touching
   *  it here would reopen the mic under live audio. Otherwise the room is
   *  free: a speak queued during the turn plays now. */
  #leaveTurn(): void {
    if (this.#drainingSpeakQueue) {
      this.#drainPriorState = 'active'
      return
    }
    this.#goActive()
    this.#kickSpeakQueue()
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
