import type { PcmAudio, SynthesizeOptions, VoiceEngine } from '../voice-engine.js'

// A deterministic, model-free VoiceEngine for consumers' unit tests — no ONNX
// model, no native lib. `synthesize` returns silence sized to the text so a test
// can assert the loop wired an utterance through (and recorded what was spoken)
// without loading a real model.

const FAKE_SAMPLE_RATE = 24000
const SECONDS_PER_CHARACTER = 0.04

export class FakeVoiceEngine implements VoiceEngine {
  readonly sampleRate = FAKE_SAMPLE_RATE
  /** Every text passed to `synthesize`, in order — a test asserts what was said. */
  readonly spoken: string[] = []

  synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio> {
    this.spoken.push(text)
    const speed = options?.speed ?? 1
    const durationSeconds = (text.length * SECONDS_PER_CHARACTER) / speed
    const sampleCount = Math.max(1, Math.round(this.sampleRate * durationSeconds))
    return Promise.resolve({
      samples: new Float32Array(sampleCount),
      sampleRate: this.sampleRate,
    })
  }
}
