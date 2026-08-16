import type { Logger } from 'pino'
import type { PcmAudio, VoiceActivityDetector } from '@vynel/voice-engine'
import {
  buildNoteFlushMessage,
  decideCallUtterance,
  isNotedSentinel,
  stripSpokenMarkup,
  type CallMode,
  type LineSpeaker,
} from '@vynel/voice'
import type { CallSessionClient } from './call-session-client.js'

// One live call's conversation loop: Cable-B segments → transcript → the pure
// turn policy → the per-call session → spoken reply into the call sink.
// Duplex by construction — call audio is NEVER gated on Vynel speaking (the
// capture side is echo-free), and speech is cut, not queued behind:
//   participant (1:1): a real utterance cancels the in-flight line and runs a
//     turn, latest wins. The cut happens AFTER transcription, never on raw VAD
//     segments — the ears hear every sound the machine plays (far-end noise,
//     dings, Vynel's own words echoed back off the far end's speaker), and
//     cutting on sound alone made Vynel chop itself mid-sentence on a live
//     Meet call. The price is one STT pass of barge-in latency.
//   notetaker (group): cross-talk must not cut — only an ADDRESSED utterance
//     cancels + responds; everything else batches into note flushes the session
//     answers with the 'noted' sentinel unless it judges it should speak up.
// Both modes drop transcripts that are echoes of recently spoken lines (the
// far-end speaker→mic loop returns them as "user" speech — policy home:
// isEchoOfSpokenLine).

const NOTE_BATCH_SIZE = 8
const NOTE_BATCH_MS = 60_000
const CALL_TURN_FAILED_LINE = 'Sorry — I hit a problem with that.'
// How long past the end of playback a line's echo can still arrive: the call
// round-trip + the far end's speaker→mic pickup + VAD closing the segment.
const ECHO_RETURN_WINDOW_MS = 4_000
// Echoes only ever mirror the freshest lines — a short memory keeps the
// swallow-a-genuine-parrot cost bounded.
const ECHO_MEMORY_LINES = 4

export interface CallConversationDeps {
  readonly logger: Logger
  readonly callId: string
  readonly mode: CallMode
  readonly sessionId: string
  readonly assistantName: string
  readonly vad: VoiceActivityDetector
  readonly transcribe: (audio: PcmAudio) => Promise<string>
  readonly lineSpeaker: LineSpeaker
  readonly sessionClient: CallSessionClient
}

export class CallConversation {
  readonly #deps: CallConversationDeps
  #segmentQueue: PcmAudio[] = []
  #drainingSegments = false
  #turnInFlight = false
  #pendingRespond: string | null = null
  #pendingFlush = false
  #pendingDirectLines: string[] = []
  #notes: string[] = []
  #noteFlushTimer: ReturnType<typeof setTimeout> | null = null
  #recentSpokenLines: { line: string; hearableUntil: number }[] = []
  #stopped = false

  constructor(deps: CallConversationDeps) {
    this.#deps = deps
  }

  /** Feed call PCM. Never blocks and never drops audio — segmentation is fast
   *  and synchronous; the slow work (STT, turns) drains a queue behind it. */
  pushAudio(audio: PcmAudio): void {
    if (this.#stopped) return
    const segments = this.#deps.vad.push(audio)
    if (segments.length === 0) return
    this.#segmentQueue.push(...segments)
    void this.#drainSegmentQueue()
  }

  notifyPlaybackDrained(): void {
    this.#deps.lineSpeaker.notifyPlaybackDrained()
  }

  /** Speak a line the CONDUCTOR supplied verbatim (a global announcement, the
   *  disclosure line at join) — FIFO, never lost, never interleaved with turn
   *  speech: direct lines hold the same single-flight the turns do. */
  speakDirect(text: string): void {
    const line = text.trim()
    if (line === '' || this.#stopped) return
    this.#pendingDirectLines.push(line)
    if (!this.#turnInFlight) void this.#runDirectSpeech()
  }

  stop(): void {
    this.#stopped = true
    this.#segmentQueue = []
    this.#pendingDirectLines = []
    this.#clearNoteFlushTimer()
    this.#deps.lineSpeaker.cancel()
  }

  async #drainSegmentQueue(): Promise<void> {
    if (this.#drainingSegments) return
    this.#drainingSegments = true
    try {
      while (this.#segmentQueue.length > 0 && !this.#stopped) {
        const segment = this.#segmentQueue.shift()!
        let transcript: string
        try {
          transcript = (await this.#deps.transcribe(segment)).trim()
        } catch (error) {
          this.#deps.logger.warn(
            { callId: this.#deps.callId, error: error instanceof Error ? error.message : String(error) },
            'call transcription failed — segment dropped',
          )
          continue
        }
        this.#handleTranscript(transcript)
      }
    } finally {
      this.#drainingSegments = false
    }
  }

  #handleTranscript(transcript: string): void {
    // A stop can land while transcription is in flight — a post-end utterance
    // must not run a turn into the dead call's session (it would leak into
    // the end-of-call report).
    if (this.#stopped) return
    const now = performance.now()
    const recentLines = this.#recentSpokenLines
      .filter((spoken) => spoken.hearableUntil > now)
      .map((spoken) => spoken.line)
    const decision = decideCallUtterance(
      this.#deps.mode,
      transcript,
      this.#deps.assistantName,
      recentLines,
    )
    if (decision.kind === 'ignore') return
    if (decision.kind === 'note') {
      this.#recordNote(transcript)
      return
    }
    // An addressed utterance always cuts an in-flight line (the participant
    // path already cut pre-transcription; this covers the notetaker path).
    if (this.#deps.lineSpeaker.isSpeaking) this.#deps.lineSpeaker.cancel()
    if (this.#turnInFlight) {
      // Latest wins: a newer address supersedes a queued one — in a live call
      // answering a stale question is worse than skipping it.
      this.#pendingRespond = transcript
      return
    }
    void this.#runRespondTurn(transcript)
  }

  #recordNote(transcript: string): void {
    this.#notes.push(transcript)
    if (this.#notes.length >= NOTE_BATCH_SIZE) {
      this.#requestFlush()
      return
    }
    if (this.#noteFlushTimer === null) {
      this.#noteFlushTimer = setTimeout(() => {
        this.#noteFlushTimer = null
        this.#requestFlush()
      }, NOTE_BATCH_MS)
    }
  }

  #requestFlush(): void {
    if (this.#notes.length === 0 || this.#stopped) return
    if (this.#turnInFlight) {
      this.#pendingFlush = true
      return
    }
    void this.#runFlushTurn()
  }

  async #runFlushTurn(): Promise<void> {
    const notes = this.#notes
    this.#notes = []
    this.#clearNoteFlushTimer()
    await this.#runTurn(buildNoteFlushMessage(notes), 'unless-noted')
  }

  async #runRespondTurn(utterance: string): Promise<void> {
    await this.#runTurn(utterance, 'always')
  }

  async #runTurn(message: string, speakPolicy: 'always' | 'unless-noted'): Promise<void> {
    this.#turnInFlight = true
    try {
      let reply = ''
      let failed = false
      for await (const event of this.#deps.sessionClient.runCallTurn(this.#deps.sessionId, message)) {
        if (event.kind === 'text') reply += event.delta
        else if (event.kind === 'failed') {
          failed = true
          this.#deps.logger.warn(
            { callId: this.#deps.callId, message: event.message },
            'call turn failed',
          )
          break
        }
      }
      if (this.#stopped) return
      if (failed) {
        // A silent failure mid-conversation reads as being ignored — but a
        // failed note flush must not interrupt the call to announce itself.
        if (speakPolicy === 'always') await this.#speak(CALL_TURN_FAILED_LINE)
        return
      }
      const spoken = stripSpokenMarkup(reply).trim()
      if (spoken === '') return
      if (speakPolicy === 'unless-noted' && isNotedSentinel(spoken)) return
      await this.#speak(spoken)
    } finally {
      this.#turnInFlight = false
      this.#runPendingWork()
    }
  }

  async #runDirectSpeech(): Promise<void> {
    this.#turnInFlight = true
    try {
      while (this.#pendingDirectLines.length > 0 && !this.#stopped) {
        const line = this.#pendingDirectLines.shift()!
        await this.#speak(line)
      }
    } finally {
      this.#turnInFlight = false
      this.#runPendingWork()
    }
  }

  #runPendingWork(): void {
    if (this.#stopped) return
    // Direct lines first (rare, conductor-initiated, time-sensitive), then the
    // latest address, then a parked note flush.
    if (this.#pendingDirectLines.length > 0) {
      void this.#runDirectSpeech()
      return
    }
    const next = this.#pendingRespond
    this.#pendingRespond = null
    if (next !== null) {
      void this.#runRespondTurn(next)
      return
    }
    if (this.#pendingFlush) {
      this.#pendingFlush = false
      void this.#runFlushTurn()
    }
  }

  async #speak(text: string): Promise<void> {
    // Hearable from the first sample until the window past the END of playback
    // (an echo of the line's start can return while its tail still plays) —
    // the open bound closes when speakLine resolves, drained or cancelled.
    const spoken = { line: text, hearableUntil: Number.POSITIVE_INFINITY }
    this.#recentSpokenLines.push(spoken)
    if (this.#recentSpokenLines.length > ECHO_MEMORY_LINES) this.#recentSpokenLines.shift()
    try {
      await this.#deps.lineSpeaker.speakLine(text)
    } catch (error) {
      this.#deps.logger.error(
        { callId: this.#deps.callId, error: error instanceof Error ? error.message : String(error) },
        'call speech failed — the line was not heard',
      )
    } finally {
      spoken.hearableUntil = performance.now() + ECHO_RETURN_WINDOW_MS
    }
  }

  #clearNoteFlushTimer(): void {
    if (this.#noteFlushTimer !== null) {
      clearTimeout(this.#noteFlushTimer)
      this.#noteFlushTimer = null
    }
  }
}
