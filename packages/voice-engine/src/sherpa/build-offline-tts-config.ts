import type { OfflineTtsConfig } from './native.js'
import type { TtsModelConfig } from '../voice-engine.js'

// Map Vynel's model-agnostic `TtsModelConfig` onto sherpa-onnx's `OfflineTtsConfig`.
// Pure + exhaustive so the mapping is unit-tested without loading a native model
// (the model files can't ride the gate). The CPU provider is fixed — Vynel voice
// is a local, GPU-free experience by design.

const DEFAULT_NUM_THREADS = 2
const CPU_PROVIDER = 'cpu'

export interface BuildOfflineTtsConfigInput {
  readonly tts: TtsModelConfig
  /** Inference threads. Default 2 — realtime on CPU without hogging the machine. */
  readonly numThreads?: number
  /** Split cap for long text. Undefined = the model default. */
  readonly maxNumSentences?: number
}

export function buildOfflineTtsConfig(input: BuildOfflineTtsConfigInput): OfflineTtsConfig {
  const base = {
    numThreads: input.numThreads ?? DEFAULT_NUM_THREADS,
    provider: CPU_PROVIDER,
    ...(input.maxNumSentences !== undefined ? { maxNumSentences: input.maxNumSentences } : {}),
  }

  const tts = input.tts
  switch (tts.kind) {
    case 'kokoro':
      return {
        ...base,
        model: {
          kokoro: {
            model: tts.model,
            voices: tts.voices,
            tokens: tts.tokens,
            dataDir: tts.dataDir,
            ...(tts.lengthScale !== undefined ? { lengthScale: tts.lengthScale } : {}),
          },
        },
      }
    case 'vits':
      return {
        ...base,
        model: {
          vits: {
            model: tts.model,
            tokens: tts.tokens,
            dataDir: tts.dataDir,
            ...(tts.lengthScale !== undefined ? { lengthScale: tts.lengthScale } : {}),
          },
        },
      }
    default:
      return assertUnreachableModel(tts)
  }
}

// Compile-time exhaustiveness + a runtime guard for a config that slipped past
// the types (e.g. a hand-built JSON from a future model kind). This is an
// internal invariant breach at engine construction, not user input — a bare
// Error (→ 500 via the api's onError) is the honest classification.
function assertUnreachableModel(model: never): never {
  throw new Error(`Unsupported TTS model kind: ${JSON.stringify(model)}`)
}
