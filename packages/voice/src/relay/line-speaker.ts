import { SpokenSentenceBuffer } from './sentence-buffer.js'

// The cancellable sentence-by-sentence speaker — ONE home for "turn a line of
// text into pipelined speech and wait until the device truly finished playing
// it". The wake-line driver and each call loop hold an instance. Pure over
// injected seams (no engine, no device import) so it stays headless-testable
// and keeps the voice↔voice-engine package boundary intact.
//
// Cancel semantics (the cutPlayback pairing contract): cancel() stops feeding
// sentences, discards the device's queued audio, and lets the in-flight
// speakLine finish as `cancelled` — which SUPPRESSES its trailing endSpeech
// (a trailing endSpeech after a cut would arm a fresh drain and double-fire).
// A cut can also fire the device's drained signal with no waiter attached;
// each speakLine resets that pending flag on entry so a cancelled line's tail
// can never satisfy the NEXT line's drain wait.

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

export class LineSpeaker {
  readonly #io: LineSpeakerIo
  #speaking = false
  #cancelled = false
  #resolveDrained: (() => void) | null = null
  #drainedPending = false

  constructor(io: LineSpeakerIo) {
    this.#io = io
  }

  get isSpeaking(): boolean {
    return this.#speaking
  }

  async speakLine(text: string): Promise<SpokenLineOutcome> {
    if (this.#speaking) {
      throw new Error('speakLine while a line is in flight — the caller must serialize speech')
    }
    this.#speaking = true
    this.#cancelled = false
    this.#drainedPending = false
    const buffer = new SpokenSentenceBuffer()
    let spoke = false
    try {
      for (const sentence of [...buffer.push(text), ...buffer.flush()]) {
        if (this.#cancelled) break
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
    }
  }

  /** Barge-in: stop the in-flight line NOW. Safe when idle — the cut no-ops. */
  cancel(): void {
    this.#cancelled = true
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
