// An energy-gated speech segmenter for the always-listening voice service. It
// consumes streamed 16 kHz mono float samples and emits ONE complete speech
// segment each time speech is followed by a gap of silence — so the wake-word
// path transcribes natural utterances, not fixed windows (no clipped phrases, no
// transcribing silence). PURE + deterministic (RMS math only — no model, no dep),
// so it's gate-tested; the ffmpeg stream that feeds it lives in the apps/voice
// shell. A dedicated wake-word model is a later efficiency upgrade; this proves
// the interaction with zero new dependencies.

export interface SpeechSegmenterOptions {
  /** Sample rate of the incoming float stream. Default 16000 (Whisper's rate). */
  sampleRate?: number
  /** RMS above this counts as speech. Default 0.012 (a quiet-room baseline). */
  energyThreshold?: number
  /** Silence after speech that ENDS a segment. Default 550 ms — a touch snappier
   *  to wake; raise it if a natural mid-sentence pause splits a command. */
  silenceDurationMs?: number
  /** Segments with less net speech than this are dropped as blips. Default 250 ms. */
  minSpeechMs?: number
  /** Force-close a runaway segment at this length. Default 12000 ms. */
  maxSegmentMs?: number
  /** Audio kept before speech onset so the first phoneme isn't clipped. Default 200 ms. */
  preRollMs?: number
}

const FRAME_MS = 20

export class SpeechSegmenter {
  readonly #threshold: number
  readonly #frameSamples: number
  readonly #silenceFrames: number
  readonly #minSpeechFrames: number
  readonly #maxSegmentFrames: number
  readonly #preRollSamples: number

  #leftover = new Float32Array(0)
  #preRoll: number[] = []
  #segment: number[] = []
  #inSpeech = false
  #speechFrames = 0
  #silenceRun = 0

  constructor(options: SpeechSegmenterOptions = {}) {
    const sampleRate = options.sampleRate ?? 16000
    this.#threshold = options.energyThreshold ?? 0.012
    this.#frameSamples = Math.round((sampleRate * FRAME_MS) / 1000)
    this.#silenceFrames = Math.max(1, Math.round((options.silenceDurationMs ?? 550) / FRAME_MS))
    this.#minSpeechFrames = Math.max(1, Math.round((options.minSpeechMs ?? 250) / FRAME_MS))
    this.#maxSegmentFrames = Math.max(1, Math.round((options.maxSegmentMs ?? 12000) / FRAME_MS))
    this.#preRollSamples = Math.round((sampleRate * (options.preRollMs ?? 200)) / 1000)
  }

  /** Feed a chunk of samples; returns any segments that completed (usually 0 or 1). */
  push(samples: Float32Array): Float32Array[] {
    const merged = concat(this.#leftover, samples)
    const frameCount = Math.floor(merged.length / this.#frameSamples)
    const segments: Float32Array[] = []
    let offset = 0
    for (let f = 0; f < frameCount; f += 1) {
      const completed = this.#processFrame(merged.subarray(offset, offset + this.#frameSamples))
      offset += this.#frameSamples
      if (completed !== null) segments.push(completed)
    }
    this.#leftover = merged.slice(offset)
    return segments
  }

  /** Close any in-progress segment (call when the stream ends). */
  flush(): Float32Array | null {
    return this.#inSpeech ? this.#closeSegment() : null
  }

  #processFrame(frame: Float32Array): Float32Array | null {
    const isSpeech = rms(frame) >= this.#threshold
    if (!this.#inSpeech) {
      // Keep a rolling pre-roll so the segment doesn't clip the first phoneme.
      appendCapped(this.#preRoll, frame, this.#preRollSamples)
      if (!isSpeech) return null
      this.#inSpeech = true
      this.#speechFrames = 1
      this.#silenceRun = 0
      this.#segment = this.#preRoll
      this.#preRoll = []
      appendAll(this.#segment, frame)
      return null
    }

    appendAll(this.#segment, frame)
    this.#speechFrames += 1
    this.#silenceRun = isSpeech ? 0 : this.#silenceRun + 1
    if (this.#silenceRun >= this.#silenceFrames || this.#speechFrames >= this.#maxSegmentFrames) {
      return this.#closeSegment()
    }
    return null
  }

  #closeSegment(): Float32Array | null {
    const netSpeechFrames = this.#speechFrames - this.#silenceRun
    let segment: Float32Array | null = null
    if (netSpeechFrames >= this.#minSpeechFrames) {
      // Drop the trailing silence-run that triggered the close — keep pre-roll +
      // speech, so Whisper gets the utterance without ~700 ms of dead air.
      const keep = Math.max(0, this.#segment.length - this.#silenceRun * this.#frameSamples)
      segment = Float32Array.from(this.#segment.slice(0, keep))
    }
    this.#segment = []
    this.#inSpeech = false
    this.#speechFrames = 0
    this.#silenceRun = 0
    return segment
  }
}

function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i] ?? 0
    sum += sample * sample
  }
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length)
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function appendAll(target: number[], frame: Float32Array): void {
  for (let i = 0; i < frame.length; i += 1) target.push(frame[i] ?? 0)
}

function appendCapped(buffer: number[], frame: Float32Array, cap: number): void {
  appendAll(buffer, frame)
  if (buffer.length > cap) buffer.splice(0, buffer.length - cap)
}
