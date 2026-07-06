import type { VadConfig } from './native.js'
import type { VadModelConfig } from '../voice-engine.js'

// Map Vynel's `VadModelConfig` onto sherpa-onnx's `VadConfig`. Pure so the
// mapping is unit-tested without loading the native model. Fixed to 16 kHz (the
// silero model's only rate + the mic capture rate) and the CPU provider.
// Optional tuning knobs are omitted when unset so the model's own defaults win.

const VAD_SAMPLE_RATE = 16000
const DEFAULT_NUM_THREADS = 1
const CPU_PROVIDER = 'cpu'

export interface BuildVadConfigInput {
  readonly vad: VadModelConfig
  /** VAD is light; one thread is plenty and leaves cores for STT/TTS. */
  readonly numThreads?: number
}

export function buildVadConfig(input: BuildVadConfigInput): VadConfig {
  const vad = input.vad
  return {
    sileroVad: {
      model: vad.model,
      ...(vad.threshold !== undefined ? { threshold: vad.threshold } : {}),
      ...(vad.minSilenceDuration !== undefined
        ? { minSilenceDuration: vad.minSilenceDuration }
        : {}),
      ...(vad.minSpeechDuration !== undefined
        ? { minSpeechDuration: vad.minSpeechDuration }
        : {}),
      ...(vad.maxSpeechDuration !== undefined
        ? { maxSpeechDuration: vad.maxSpeechDuration }
        : {}),
    },
    sampleRate: VAD_SAMPLE_RATE,
    numThreads: input.numThreads ?? DEFAULT_NUM_THREADS,
    provider: CPU_PROVIDER,
  }
}
