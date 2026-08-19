import { SpokenSentenceBuffer } from './sentence-buffer.js'

// The cancellable sentence-by-sentence speaker — ONE home for "turn text into
// pipelined speech and wait until the device truly finished playing it". The
// wake-line driver and each call loop hold an instance. Pure over injected
// seams (no engine, no device import) so it stays headless-testable and keeps
// the voice↔voice-engine package boundary intact.
//
// Two doors, one pipeline: `speakLine(text)` speaks a line it has in full;
// `speakStreamed()` opens a line whose sentences arrive over time (a reply
// spoken AS the model writes it — voice-realtime VR1). Either way a sentence's
// synthesis overlaps the previous sentence's playback: `emitAudio` hands audio
// to the device and returns, so the loop is already synthesizing N+1 while N
// plays. The first sound waits for one sentence's synthesis, never the reply's.
//
// Cancel semantics (the cutPlayback pairing contract): cancel() stops feeding
// sentences, discards the device's queued audio, and lets the in-flight line
// finish as `cancelled` — which SUPPRESSES its trailing endSpeech (a trailing
// endSpeech after a cut would arm a fresh drain and double-fire). A cut can
// also fire the device's drained signal with no waiter attached; each line
// resets that pending flag on entry so a cancelled line's tail can never
// satisfy the NEXT line's drain wait.

export interface SpokenAudio {
  readonly samples: Float32Array
  readonly sampleRate: number
}

export interface LineSpeakerIo {
  synthesize(sentence: string): Promise<SpokenAudio>
  emitAudio(audio: SpokenAudio): void | Promise<void>
  /** All sentences sent — the device reports the true end via notifyPlaybackDrained(). */
  endSpeech(): void
  /** Discard everything queued on the device NOW (the barge-in cut). */
  cutPlayback(): void
}

export interface SpokenLineOutcome {
  readonly spoke: boolean
  readonly cancelled: boolean
}

/** A line spoken as its sentences arrive. */
export interface StreamedLine {
  /** Queue the next sentence (or clause) — spoken in order, pipelined behind the one before. */
  push(sentence: string): void
  /** No more sentences are coming; the line drains and `outcome` settles. */
  end(): void
  /** Barge-in on THIS line: cut playback and stop feeding it (no-op once it is over). */
  cancel(): void
  /** Settles once the device truly finished the line, or it was cancelled. */
  readonly outcome: Promise<SpokenLineOutcome>
}

export class LineSpeaker {
  readonly #io: LineSpeakerIo
  #speaking = false
  #cancelled = false
  #resolveDrained: (() => void) | null = null
  #drainedPending = false
  #activeQueue: SentenceQueue | null = null

  constructor(io: LineSpeakerIo) {
    this.#io = io
  }

  get isSpeaking(): boolean {
    return this.#speaking
  }

  async speakLine(text: string): Promise<SpokenLineOutcome> {
    const queue = this.#openQueue()
    const buffer = new SpokenSentenceBuffer()
    for (const sentence of [...buffer.push(text), ...buffer.flush()]) queue.push(sentence)
    queue.close()
    return this.#speakSentences(queue)
  }

  /** Open a streamed line. Throws (like a second speakLine) while a line is in
   *  flight — the caller serializes speech. */
  speakStreamed(): StreamedLine {
    const queue = this.#openQueue()
    return {
      push: (sentence) => queue.push(sentence),
      end: () => queue.close(),
      cancel: () => {
        if (this.#activeQueue === queue) this.cancel()
      },
      outcome: this.#speakSentences(queue),
    }
  }

  /** Barge-in: stop the in-flight line NOW. Safe when idle — the cut no-ops. */
  cancel(): void {
    this.#cancelled = true
    this.#activeQueue?.close()
    this.#io.cutPlayback()
  }

  /** The device finished (or discarded) all queued audio. */
  notifyPlaybackDrained(): void {
    if (this.#resolveDrained !== null) {
      const resolve = this.#resolveDrained
      this.#resolveDrained = null
      resolve()
    } else {
      this.#drainedPending = true
    }
  }

  #openQueue(): SentenceQueue {
    if (this.#speaking) {
      throw new Error('speakLine while a line is in flight — the caller must serialize speech')
    }
    this.#speaking = true
    this.#cancelled = false
    this.#drainedPending = false
    const queue = new SentenceQueue()
    this.#activeQueue = queue
    return queue
  }

  async #speakSentences(queue: SentenceQueue): Promise<SpokenLineOutcome> {
    let spoke = false
    try {
      for (;;) {
        if (this.#cancelled) break
        const sentence = queue.shift()
        if (sentence === undefined) {
          if (queue.closed) break
          await queue.whenChanged()
          continue
        }
        const audio = await this.#io.synthesize(sentence)
        // Synthesis is the slow await — a cancel may have landed during it, and
        // emitting now would speak into a freshly-cut device.
        if (this.#cancelled) break
        await this.#io.emitAudio(audio)
        spoke = true
      }
      if (spoke && !this.#cancelled) {
        this.#io.endSpeech()
        await this.#awaitDrained()
      }
      return { spoke, cancelled: this.#cancelled }
    } finally {
      this.#speaking = false
      this.#activeQueue = null
    }
  }

  #awaitDrained(): Promise<void> {
    if (this.#drainedPending) {
      this.#drainedPending = false
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.#resolveDrained = resolve
    })
  }
}

// The sentences of one line, in order, fed by a producer that may still be
// writing them. A closed queue accepts nothing more; `whenChanged` wakes the
// speaking loop on the next push or close.
class SentenceQueue {
  #items: string[] = []
  #closed = false
  #wake: (() => void) | null = null

  get closed(): boolean {
    return this.#closed
  }

  push(sentence: string): void {
    if (this.#closed) return
    this.#items.push(sentence)
    this.#notify()
  }

  close(): void {
    this.#closed = true
    this.#notify()
  }

  shift(): string | undefined {
    return this.#items.shift()
  }

  whenChanged(): Promise<void> {
    return new Promise((resolve) => {
      this.#wake = resolve
    })
  }

  #notify(): void {
    const wake = this.#wake
    this.#wake = null
    wake?.()
  }
}
