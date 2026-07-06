import type { OfflineRecognizerConfig } from './native.js'
import type { SttModelConfig } from '../voice-engine.js'

// Map Vynel's model-agnostic `SttModelConfig` onto sherpa-onnx's
// `OfflineRecognizerConfig`. Pure so the mapping is unit-tested without loading a
// native model. CPU provider is fixed — local, GPU-free. One STT kind today
// (moonshine); this becomes a `never`-exhaustive switch once a second lands.

const DEFAULT_NUM_THREADS = 2
const CPU_PROVIDER = 'cpu'

export interface BuildOfflineRecognizerConfigInput {
  readonly stt: SttModelConfig
  readonly numThreads?: number
}

export function buildOfflineRecognizerConfig(
  input: BuildOfflineRecognizerConfigInput,
): OfflineRecognizerConfig {
  const stt = input.stt
  if (stt.kind !== 'moonshine') {
    // An internal invariant breach (a config that slipped past the types), not
    // user input — a bare Error (→ 500 via the api's onError) is honest.
    throw new Error(`Unsupported STT model kind: ${JSON.stringify(stt)}`)
  }

  return {
    modelConfig: {
      moonshine: {
        preprocessor: stt.preprocessor,
        encoder: stt.encoder,
        uncachedDecoder: stt.uncachedDecoder,
        cachedDecoder: stt.cachedDecoder,
      },
      tokens: stt.tokens,
      numThreads: input.numThreads ?? DEFAULT_NUM_THREADS,
      provider: CPU_PROVIDER,
    },
  }
}
