import { join } from 'node:path'
import type { SttModelConfig, TtsModelConfig } from '@vynel/voice-engine'

// The registry of downloadable sherpa-onnx models. Each entry knows its release
// archive and how to turn an extracted folder into a Vynel model config.
// `fetch-voice-models` downloads by name (kind-agnostic); `synthesize-smoke`
// loads TTS entries; `benchmark` loads both. Add ZipVoice / Chatterbox (TTS) or
// other STT models here as we adopt them — the engine contracts already accept
// them.

interface DownloadableModel {
  /** Top-level folder the archive extracts to, under `.models/voice/`. */
  readonly folder: string
  /** The sherpa-onnx release `.tar.bz2` URL. */
  readonly archiveUrl: string
  /** Approximate download size, shown before a long fetch. */
  readonly approxSize: string
}

export interface TtsModelEntry extends DownloadableModel {
  readonly kind: 'tts'
  toTtsConfig(baseDir: string): TtsModelConfig
}

export interface SttModelEntry extends DownloadableModel {
  readonly kind: 'stt'
  toSttConfig(baseDir: string): SttModelConfig
}

export type VoiceModelEntry = TtsModelEntry | SttModelEntry

const TTS_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

export const voiceModels: Readonly<Record<string, VoiceModelEntry>> = {
  // Vynel's default voice — 11 natural English speakers, 24 kHz.
  kokoro: {
    kind: 'tts',
    folder: 'kokoro-en-v0_19',
    archiveUrl: `${TTS_RELEASE}/kokoro-en-v0_19.tar.bz2`,
    approxSize: '~340 MB',
    toTtsConfig: (baseDir) => ({
      kind: 'kokoro',
      model: join(baseDir, 'model.onnx'),
      voices: join(baseDir, 'voices.bin'),
      tokens: join(baseDir, 'tokens.txt'),
      dataDir: join(baseDir, 'espeak-ng-data'),
    }),
  },
  // A small single-speaker fallback for a fast first download, 22.05 kHz.
  'piper-lessac': {
    kind: 'tts',
    folder: 'vits-piper-en_US-lessac-medium',
    archiveUrl: `${TTS_RELEASE}/vits-piper-en_US-lessac-medium.tar.bz2`,
    approxSize: '~61 MB',
    toTtsConfig: (baseDir) => ({
      kind: 'vits',
      model: join(baseDir, 'en_US-lessac-medium.onnx'),
      tokens: join(baseDir, 'tokens.txt'),
      dataDir: join(baseDir, 'espeak-ng-data'),
    }),
  },
  // The listening side — Moonshine tiny English (int8), the realtime-on-CPU STT.
  moonshine: {
    kind: 'stt',
    folder: 'sherpa-onnx-moonshine-tiny-en-int8',
    archiveUrl: `${ASR_RELEASE}/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2`,
    approxSize: '~50 MB',
    toSttConfig: (baseDir) => ({
      kind: 'moonshine',
      preprocessor: join(baseDir, 'preprocess.onnx'),
      encoder: join(baseDir, 'encode.int8.onnx'),
      uncachedDecoder: join(baseDir, 'uncached_decode.int8.onnx'),
      cachedDecoder: join(baseDir, 'cached_decode.int8.onnx'),
      tokens: join(baseDir, 'tokens.txt'),
    }),
  },
}

export const DEFAULT_VOICE_MODEL = 'kokoro'

/** Where models live — gitignored, resolved from the repo root (cwd of a `pnpm` script run). */
export const voiceModelsDir = join(process.cwd(), '.models', 'voice')

export function resolveVoiceModel(name: string): VoiceModelEntry {
  const entry = voiceModels[name]
  if (entry === undefined) {
    const known = Object.keys(voiceModels).join(', ')
    throw new Error(`Unknown model "${name}". Known models: ${known}.`)
  }
  return entry
}
