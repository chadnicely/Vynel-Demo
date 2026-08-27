import type { Logger } from 'pino'
import {
  SpokenSentenceBuffer,
  stripSpokenMarkup,
  type SpokenEchoFilter,
  type SpokenLine,
  type StreamedLine,
} from '@vynel/voice'
import { armTurnWatchdog } from './turn-watchdog.js'
import type { VoiceBrainClient } from './voice-session-types.js'

// ONE brain turn on the wake line, from the utterance to the last spoken word
// (voice-realtime VR1/VR2). It reads the stream and speaks the text AS IT
// STREAMS — sentence/clause-chunked, synthesis pipelined one chunk ahead, the
// first chunk spoken the moment it closes — remembers what it said (the echo
// filter), learns its session id (the interrupt target), and can be BARGED IN
// ON: cut playback, stop reading, stop the server turn. The driver owns the
// room (states, mic); this owns one turn's life.

export type SpokenTurnOutcome = 'completed' | 'failed' | 'interrupted'

/** A hung interrupt must not hold the next turn hostage — local-api is on the
 *  loopback; a response that does not come in this long is not coming. */
const INTERRUPT_TIMEOUT_MS = 2_000

export interface SpokenBrainTurnDeps {
  readonly logger: Logger
  readonly brain: VoiceBrainClient
  /** Reserve the speaker and open a streamed line on it — resolves once the
   *  lane is ours (the previous line may still be settling). */
  readonly openSpeech: () => Promise<StreamedLine>
  readonly echoFilter: SpokenEchoFilter
  /** Silence (no text yet) this long trips the watchdog; 0 disables. */
  readonly turnWatchdogMs: number
  /** The first chunk is on its way to the speaker. */
  readonly onSpeaking?: () => void
}

export class SpokenBrainTurn {
  readonly #deps: SpokenBrainTurnDeps
  readonly #abort = new AbortController()
  #sessionId: string | null = null
  #streamEnded = false
  #cancelled = false
  #interruptOnceKnown = false
  #watchdogFired = false
  #fireWatchdog: () => void = () => {}
  /** Resolves when the watchdog fires; stays pending forever if it never does. */
  readonly whenWatchdogFired: Promise<void>
  #speech: Promise<StreamedLine> | null = null
  #line: StreamedLine | null = null
  #pendingChunks: string[] = []
  #spokenLine: SpokenLine | null = null
  #textEnded = false
  #startedAt = 0
  #firstTextAt: number | null = null
  /** The assistant message the current text block belongs to — a change of it
   *  is a block boundary and flushes the sentence buffer. */
  #messageId: string | null = null

  constructor(deps: SpokenBrainTurnDeps) {
    this.#deps = deps
    this.whenWatchdogFired = new Promise((resolve) => {
      this.#fireWatchdog = resolve
    })
  }

  get watchdogFired(): boolean {
    return this.#watchdogFired
  }

  /** Whether any text reached the speaker — the watchdog line is only for a
   *  turn the room heard nothing from. */
  get hasSpoken(): boolean {
    return this.#speech !== null
  }

  /** Run the turn to its end: the stream read AND the speech drained. NEVER
   *  rejects — every failure comes back as an outcome, because the driver may
   *  be watching this DETACHED (a turn the watchdog released keeps running in
   *  the background, with nothing left holding its promise). */
  async run(utterance: string): Promise<SpokenTurnOutcome> {
    this.#startedAt = Date.now()
    const watchdog = armTurnWatchdog(this.#deps.turnWatchdogMs)
    void watchdog.whenExpired.then(() => {
      this.#watchdogFired = true
      this.#fireWatchdog()
    })
    const buffer = new SpokenSentenceBuffer()
    let outcome: SpokenTurnOutcome = 'completed'
    try {
      for await (const event of this.#deps.brain.runTurn(utterance, this.#abort.signal)) {
        if (event.kind === 'session') {
          this.#sessionId = event.sessionId
          if (this.#interruptOnceKnown) {
            // The user barged in before the server had named this turn's
            // session — now it has: stop it, and stop reading.
            this.#interruptOnceKnown = false
            this.#abort.abort()
            void this.#stopServerTurn()
            break
          }
          continue
        }
        if (this.#cancelled) continue
        if (event.kind === 'text') {
          if (this.#firstTextAt === null) {
            // The turn's latency ledger, half 1: how long the BRAIN took to say
            // its first word (CLI spawn + auth + resume + the model's tool
            // calls all land here). Half 2 is `firstSpeechRequestMs` below.
            this.#firstTextAt = Date.now()
            this.#deps.logger.info(
              { firstTextMs: this.#firstTextAt - this.#startedAt },
              'voice turn — first text from the brain',
            )
          }
          watchdog.touch()
          // A new assistant message = the previous block is finished speech —
          // its bare-period ending never trips the buffer's own boundary.
          if (
            event.messageId !== undefined &&
            this.#messageId !== null &&
            event.messageId !== this.#messageId
          ) {
            this.#speak(buffer.flush())
          }
          this.#messageId = event.messageId ?? this.#messageId
          this.#speak(buffer.push(event.delta))
        } else if (event.kind === 'text-break') {
          // A tool call started: speak what the model finished saying while
          // the tool runs, instead of piling it up until the turn ends.
          this.#speak(buffer.flush())
        } else if (event.kind === 'queued') {
          // Nothing is spoken for a parked turn (VR3): the model's own first
          // sentence is the acknowledgment, when it comes.
          this.#deps.logger.debug('voice turn queued behind another — waiting silently')
        } else if (event.kind === 'failed') {
          outcome = 'failed'
          this.#deps.logger.warn({ message: event.message }, 'voice turn failed')
          break
        } else if (event.kind === 'interrupted') {
          outcome = 'interrupted'
          break
        } else if (event.kind === 'completed') {
          // The session's own end decides the turn — whatever the transport
          // still carries after it is the server's business.
          break
        }
      }
    } catch (error) {
      outcome = 'failed'
      this.#deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'voice turn stream broke',
      )
    } finally {
      this.#streamEnded = true
      watchdog.disarm()
    }
    // The stream's own failures are already outcomes; this tail is the last
    // place one could still escape as a rejection (the speaker seams, the
    // driver's onSpeaking) — it comes back as an outcome like every other.
    try {
      if (this.#cancelled) outcome = 'interrupted'
      else this.#speak(buffer.flush())
      await this.#finishSpeech()
    } catch (error) {
      outcome = 'failed'
      this.#deps.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'voice turn broke while finishing its speech',
      )
    }
    return outcome
  }

  /** The user talked over this turn: cut playback NOW, stop reading, and stop
   *  the server turn. Resolves once the server acknowledged the stop (or there
   *  was nothing to stop), so the next turn is never queued behind a turn that
   *  is about to die — or killed by a stop that lands late on its session. */
  async bargeIn(): Promise<void> {
    if (this.#cancelled) return
    this.#cancelled = true
    this.#pendingChunks = []
    this.#line?.cancel()
    if (this.#streamEnded) return
    if (this.#sessionId === null) {
      // Not even the server has named the session yet — the read stays open
      // only until it does (the `session` branch in run), then stops it.
      this.#interruptOnceKnown = true
      this.#deps.logger.debug('barge-in before the session was known — stopping it as soon as it is')
      return
    }
    this.#abort.abort()
    await this.#stopServerTurn()
  }

  async #stopServerTurn(): Promise<void> {
    const sessionId = this.#sessionId
    if (sessionId === null) return
    try {
      const stopped = await Promise.race([
        this.#deps.brain.interruptTurn(sessionId),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('interrupt timed out')), INTERRUPT_TIMEOUT_MS).unref?.(),
        ),
      ])
      this.#deps.logger.info({ sessionId, stopped }, 'barge-in — server turn interrupted')
    } catch (error) {
      this.#deps.logger.warn(
        { sessionId, error: error instanceof Error ? error.message : String(error) },
        'barge-in — interrupting the server turn failed; it may run on and the next turn queues behind it',
      )
    }
  }

  #speak(chunks: readonly string[]): void {
    for (const chunk of chunks) {
      // The safety net: a markdown slip must never voice "asterisk".
      const spoken = stripSpokenMarkup(chunk)
      if (spoken === '') continue
      // One growing line per turn, so an echo straddling two chunks still matches.
      if (this.#spokenLine === null) this.#spokenLine = this.#deps.echoFilter.remember(spoken)
      else this.#spokenLine.append(spoken)
      if (this.#line !== null) this.#line.push(spoken)
      else {
        this.#pendingChunks.push(spoken)
        this.#requestSpeech()
      }
    }
  }

  #requestSpeech(): void {
    if (this.#speech !== null) return
    // Half 2 of the latency ledger: utterance → the first chunk handed to the
    // speaker. What the user waits beyond this is synthesis + the device.
    this.#deps.logger.info(
      { firstSpeechRequestMs: Date.now() - this.#startedAt },
      'voice turn — first chunk to the speaker',
    )
    this.#deps.onSpeaking?.()
    this.#speech = this.#deps.openSpeech().then((line) => {
      this.#line = line
      if (this.#cancelled) {
        line.end()
        return line
      }
      for (const chunk of this.#pendingChunks) line.push(chunk)
      this.#pendingChunks = []
      if (this.#textEnded) line.end()
      return line
    })
  }

  async #finishSpeech(): Promise<void> {
    this.#textEnded = true
    try {
      if (this.#speech !== null) {
        const line = await this.#speech
        line.end()
        await line.outcome
      }
    } catch (error) {
      this.#deps.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'voice turn speech failed — the rest of the answer was not heard',
      )
    } finally {
      this.#spokenLine?.end()
    }
  }
}
