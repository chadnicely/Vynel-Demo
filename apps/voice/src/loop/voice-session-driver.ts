import type { PcmAudio } from '@vynel/voice-engine'
import { DEFAULT_VOICE_TURN_WATCHDOG_MS } from '@vynel/contracts/voice/turn-watchdog'
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
//   HANDED-OFF — a browser surface owns the command session (Web Speech STT +
//              spoken reply run THERE), because it claimed a wake OR because it
//              announced its own start (`beginHandoff()` — the Display switch,
//              the mic button). The daemon ignores all audio until
//              `endHandoff()` returns it to ASLEEP: web recognition wins the
//              microphone whenever a web surface is live, and the native STT is
//              left to wake-word detection and the no-browser cases.
//
// Every dependency is injected so the whole flow is unit-tested with fakes; the
// audio device + models + brain client are wired in the shell.

const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const FAILED_TURN_LINE = 'Sorry, I ran into a problem with that.'
const STILL_WORKING_LINE = "Still working on that — I'll tell you when it's done."
// A turn can SUCCEED having produced no text at all (it only ran tools, or a
// decayed spoken directive left it silent). The thread's streamed text is its
// voice (voice-realtime VR1), so no text means the room hears nothing and the
// user cannot tell "done" from "hung" — audit r2 R2-O.
const NOTHING_SAID_LINE = "That's done — I didn't have anything to say about it."

type DriverState = 'asleep' | 'active' | 'in-turn' | 'relaying' | 'handed-off'

/** How long he may pause mid-sentence before the film takes him as finished.
 *  Longer than a comma, longer than a breath — he asked for the software
 *  updates and it jumped in before the sentence was done (Chad, 2026-08-31,
 *  at 1100ms). Two seconds of true silence is a finished thought; the
 *  thinking beat on the answer covers the extra wait on camera. */
const FILMED_CUE_SETTLE_MS = 1900

/** How long a staged take may keep the room waking on any word. */
const FILMING_TTL_MS = 15 * 60 * 1000

/** WHAT COUNTS AS HIS CUE while filming. Any utterance moves the film, so
 *  the bar has to keep out the things a room produces that are not him
 *  talking to camera: the tail of the take's own last word, a chair, a
 *  breath, a click. Each of those transcribes to a fragment.
 *
 *  He asked a real question and got the dev updates before he had spoken
 *  (Chad, 2026-08-30) — the film cued itself on its own leftovers. Two words,
 *  or one long one, is a line said to a camera. */
function isSpokenCue(transcript: string): boolean {
  const words = transcript.trim().split(/s+/).filter((word) => word.length > 1)
  if (words.length >= 2) return true
  return (words[0]?.length ?? 0) >= 5
}

export class VoiceSessionDriver {
  readonly #deps: VoiceSessionDriverDeps
  readonly #idleTimeoutMs: number
  readonly #turnWatchdogMs: number

  #state: DriverState = 'asleep'
  /** A take is staged and waiting on him: any utterance is the cue. See
   *  setFilming(). */
  #filming = false
  #filmingUntil = 0
  /** What he has said so far this cue, across the pauses in it. */
  #filmedCue = ''
  #filmedCueTimer: ReturnType<typeof setTimeout> | null = null
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
    this.#turnWatchdogMs = options.turnWatchdogMs ?? DEFAULT_VOICE_TURN_WATCHDOG_MS
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

  /** A browser voice session STARTED without a wake — the Display switch, the
   *  mic button, the dock's own start. The web recognizer (Web Speech) owns the
   *  microphone from here, so the daemon must stop transcribing the same room:
   *  without this seam it stayed ASLEEP with an open mic, ran every utterance
   *  through the native STT to test the wake phrase, and could wake mid-
   *  conversation — on the user's own words, or on the assistant's reply coming
   *  back off the speakers (the browser plays it, so the echo filter, which only
   *  knows the daemon's own speaker, never heard of it). Idempotent: a wake
   *  handoff already put us here, and the client announces its start anyway. */
  /** FILMING (Chad, 2026-08-30: “it doesn't matter what I say — as soon as I
   *  say something and stop it should go”).
   *
   *  A filmed take is three exchanges and the film decides which one plays by
   *  COUNTING them, never by reading the words. Requiring a phrase put a
   *  speech recogniser in the critical path of a shoot: a quiet microphone
   *  turned “What's up Pacino” into “What's that, Pac” and the take was lost
   *  while he stood in front of a camera. Filming, every real utterance is
   *  the cue — he says his own line and the film moves with him.
   *
   *  Off by default and only ever set while Demo Mode is armed, because on
   *  any other day a microphone that wakes on ANY speech is unusable. */
  setFilming(filming: boolean): void {
    this.#filming = filming
    if (!filming) {
      if (this.#filmedCueTimer !== null) clearTimeout(this.#filmedCueTimer)
      this.#filmedCueTimer = null
      this.#filmedCue = ''
    }
    // A DEAD MAN'S SWITCH. Filming makes the microphone wake on any word in
    // the room, so it must never be able to outlive the take that asked for
    // it: a browser that crashes, a tab closed mid-shoot, or a message that
    // never arrives would otherwise leave the machine listening to a whole
    // household (Chad, 2026-08-30 — he was on another screen and could not
    // stop it playing). A take runs minutes; this is generous and still
    // bounded.
    this.#filmingUntil = filming ? Date.now() + FILMING_TTL_MS : 0
  }

  get #isFilming(): boolean {
    if (!this.#filming) return false
    if (Date.now() <= this.#filmingUntil) return true
    this.#filming = false
    this.#deps.logger.info('filming expired — back to the wake phrase')
    return false
  }

  beginHandoff(): void {
    if (this.#state === 'handed-off') return
    void this.#abandonRunningTurn()
    // A stale pending end would make the drain's finally sleep us right back
    // out of the handoff we are taking.
    this.#endHandoffPending = false
    this.#clearIdleTimer()
    if (this.#drainingSpeakQueue) {
      // A relay line is playing: the drain owns the state, so only its restore
      // target moves — reopening the mic under live audio is what that guards.
      this.#drainPriorState = 'handed-off'
      return
    }
    this.#state = 'handed-off'
    this.#deps.io.setState('idle')
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

  /** End the NATIVE conversation on the user's say-so (the `stop_listening`
   *  tool / the sidecar's Stop): cut whatever is running and fall asleep —
   *  the next "hey vynel" starts fresh. A handed-off session belongs to the
   *  browser (the voice-stop frame ends it there, and its own session-end
   *  returns the mic); a relay line mid-drain keeps the drain's state rules
   *  and only retargets its restore to asleep. */
  stopListening(): void {
    // The getter, not the raw state: a relay line draining ON TOP of a handoff
    // sits in 'relaying' with the handoff as its restore target — retargeting
    // that to asleep would resume wake-listening under a live browser mic.
    if (this.isHandedOff) return
    void this.#abandonRunningTurn()
    if (this.#drainingSpeakQueue) {
      this.#drainPriorState = 'asleep'
      return
    }
    this.#toAsleep()
  }

  async #handleSegment(segment: PcmAudio): Promise<void> {
    // Asleep = wake listening → ALWAYS the local recognizer (the room never
    // streams to a cloud API). Once a conversation is live, the utterance is
    // a command — the session lane (a cloud provider, when picked) hears it.
    // A transcription failure is a ROUTINE event on that lane (engine
    // restarting, provider outage) and `pushAudio` is fire-and-forget — a
    // throw here would be an unhandled rejection that kills the daemon, so
    // the utterance is dropped with a warning and the mic keeps listening
    // (the call leg's precedent).
    let transcript: string
    try {
      transcript = (
        this.#state === 'asleep' || this.#deps.transcribeCommand === undefined
          ? await this.#deps.recognizer.transcribe(segment)
          : await this.#deps.transcribeCommand(segment)
      ).trim()
    } catch (error) {
      this.#deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'transcription failed — dropped the utterance, still listening',
      )
      return
    }
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
    // Filming, ANY utterance is the cue and it is handed over whole — the
    // film counts exchanges rather than reading words.
    if (this.#isFilming) {
      this.#gatherFilmedCue(transcript)
      return
    }
    const wake = detectWakeWord(transcript, {
      extraWakeNames: this.#deps.readWakeNames?.() ?? [],
    })
    if (!wake.detected) return
    this.#deliverWake(wake.command)
  }

  /** WAIT FOR HIM TO FINISH (Chad, 2026-08-30). He meant to say “Nice — and
   *  how did we do with development?” and the film left on “Nice”: the voice
   *  detector cuts a segment at any pause, so a sentence with a comma in it
   *  arrives in pieces and the first piece was taken as the whole cue.
   *
   *  Filming, segments are gathered instead. The cue is delivered once he has
   *  been quiet long enough to have meant it — which is what “say something
   *  and stop” actually asks for. */
  #gatherFilmedCue(transcript: string): void {
    const heard = `${this.#filmedCue} ${transcript}`.trim()
    // Nothing but room noise so far: keep waiting rather than starting a
    // sentence out of a chair creak.
    if (!isSpokenCue(heard)) return
    this.#filmedCue = heard
    if (this.#filmedCueTimer !== null) clearTimeout(this.#filmedCueTimer)
    this.#filmedCueTimer = setTimeout(() => {
      const command = this.#filmedCue
      this.#filmedCue = ''
      this.#filmedCueTimer = null
      if (this.#state !== 'asleep' || !this.#isFilming) return
      this.#deps.logger.debug({ command }, 'filmed cue')
      this.#deliverWake(command)
    }, FILMED_CUE_SETTLE_MS)
  }

  /** The wake path, shared by the phrase and the filmed cue. */
  #deliverWake(command: string): void {
    this.#deps.io.setState('wake')
    if (this.#deps.wakeHandoff?.shouldHandOff() === true) {
      void this.#abandonRunningTurn()
      this.#state = 'handed-off'
      this.#deps.wakeHandoff.publishWake(command)
      return
    }
    if (command) {
      this.#startTurn(command)
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
    this.#sayTurnEnded(turn, first.outcome)
  }

  /** The room must never be left guessing: a failed turn says so, and a turn
   *  that ENDED having said nothing says that too (R2-O). An interrupted turn
   *  is the user's own barge-in — they are already talking. */
  #sayTurnEnded(turn: SpokenBrainTurn, outcome: SpokenTurnOutcome): void {
    if (outcome === 'failed') this.speak(FAILED_TURN_LINE)
    else if (outcome === 'completed' && !turn.hasSpoken) this.speak(NOTHING_SAID_LINE)
  }

  // A turn the watchdog released ended in the background: its late answer just
  // played (or it failed — say so, as for any turn) — forget it, and give the
  // conversation window back. Never reached while a newer turn or a handoff
  // owns the room: both abandon the old turn first.
  #settleBackgroundTurn(turn: SpokenBrainTurn, outcome: SpokenTurnOutcome): void {
    if (this.#runningTurn !== turn) return
    this.#runningTurn = null
    this.#leaveTurn()
    // The watchdog already promised "I'll tell you when it's done" — a silent
    // finish here would break exactly that promise.
    this.#sayTurnEnded(turn, outcome)
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
