import { Vad } from './native.js'
import type { PcmAudio, VoiceActivityDetector } from '../voice-engine.js'
import { buildVadConfig } from './build-vad-config.js'
import type { BuildVadConfigInput } from './build-vad-config.js'

// The sherpa-onnx-node silero voice-activity detector. Consumes a continuous
// 16 kHz mono stream and emits complete speech segments (speech ended by
// silence) — so the loop transcribes natural utterances, not fixed windows.
// The input MUST be 16 kHz: unlike the recognizer, the VAD trusts its configured
// rate and does not resample. The native lib is reached only through `./native.js`.

const VAD_SAMPLE_RATE = 16000
// Internal ring buffer. Longer than any single utterance so a long sentence is
// never dropped before `maxSpeechDuration` force-closes it.
const BUFFER_SECONDS = 30

export type SherpaVoiceActivityDetectorOptions = BuildVadConfigInput

export class SherpaVoiceActivityDetector implements VoiceActivityDetector {
  readonly #vad: Vad

  constructor(options: SherpaVoiceActivityDetectorOptions) {
    this.#vad = new Vad(buildVadConfig(options), BUFFER_SECONDS)
  }

  push(audio: PcmAudio): PcmAudio[] {
    this.#vad.acceptWaveform(audio.samples)
    return this.#drainSegments()
  }

  flush(): PcmAudio[] {
    this.#vad.flush()
    return this.#drainSegments()
  }

  #drainSegments(): PcmAudio[] {
    const segments: PcmAudio[] = []
    while (!this.#vad.isEmpty()) {
      segments.push({ samples: this.#vad.front().samples, sampleRate: VAD_SAMPLE_RATE })
      this.#vad.pop()
    }
    return segments
  }
}
