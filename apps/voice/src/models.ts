import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SttModelConfig, TtsModelConfig, VadModelConfig } from '@vynel/voice-engine'

// Resolve model file paths from the models dir. The folder layout mirrors what
// `pnpm voice:fetch-models` extracts (kept in sync with scripts/src/voice/
// voice-models.ts by convention — the daemon stays independent of dev tooling).

export type TtsChoice = 'kokoro' | 'piper-lessac'

export function resolveTtsConfig(modelsDir: string, choice: TtsChoice): TtsModelConfig {
  if (choice === 'kokoro') {
    const base = join(modelsDir, 'kokoro-en-v0_19')
    return {
      kind: 'kokoro',
      model: join(base, 'model.onnx'),
      voices: join(base, 'voices.bin'),
      tokens: join(base, 'tokens.txt'),
      dataDir: join(base, 'espeak-ng-data'),
    }
  }
  const base = join(modelsDir, 'vits-piper-en_US-lessac-medium')
  return {
    kind: 'vits',
    model: join(base, 'en_US-lessac-medium.onnx'),
    tokens: join(base, 'tokens.txt'),
    dataDir: join(base, 'espeak-ng-data'),
  }
}

export function resolveSttConfig(modelsDir: string): SttModelConfig {
  const base = join(modelsDir, 'sherpa-onnx-moonshine-tiny-en-int8')
  return {
    kind: 'moonshine',
    preprocessor: join(base, 'preprocess.onnx'),
    encoder: join(base, 'encode.int8.onnx'),
    uncachedDecoder: join(base, 'uncached_decode.int8.onnx'),
    cachedDecoder: join(base, 'cached_decode.int8.onnx'),
    tokens: join(base, 'tokens.txt'),
  }
}

export function resolveVadConfig(modelsDir: string): VadModelConfig {
  return { model: join(modelsDir, 'silero-vad', 'silero_vad.onnx') }
}

/** The model files the daemon needs present to run. Returns the first missing
 *  path, or null when everything is in place — so main can fail with a clear
 *  "run pnpm voice:fetch-models" instead of a cryptic native load error. */
export function findMissingModelFile(
  tts: TtsModelConfig,
  stt: SttModelConfig,
  vad: VadModelConfig,
): string | null {
  const required = [
    tts.model,
    ...(tts.kind === 'kokoro' ? [tts.voices] : []),
    tts.tokens,
    stt.encoder,
    stt.tokens,
    vad.model,
  ]
  return required.find((path) => !existsSync(path)) ?? null
}
