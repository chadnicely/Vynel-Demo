import { join } from 'node:path'
import type { SttModelConfig, TtsModelConfig, VadModelConfig } from '@vynel/voice-engine'

// The registry of downloadable sherpa-onnx models. Each entry knows how to fetch
// itself (a `.tar.bz2` archive or a single file) and how to turn the extracted
// folder into a Vynel model config. `fetch-voice-models` downloads by name;
// `synthesize-smoke` loads TTS; `benchmark` loads TTS + STT. Add ZipVoice /
// Chatterbox (TTS) or a KWS model here as we adopt them.

interface DownloadableModel {
  /** Folder under `.models/voice/` holding the model after fetch. */
  readonly folder: string
  /** Approximate download size, shown before a long fetch. */
  readonly approxSize: string
  /** How to fetch it: an archive to extract, or a single file to drop in `folder`. */
  readonly download: { readonly format: 'archive' | 'file'; readonly url: string }
}

export interface TtsModelEntry extends DownloadableModel {
  readonly kind: 'tts'
  toTtsConfig(baseDir: string): TtsModelConfig
}

export interface SttModelEntry extends DownloadableModel {
  readonly kind: 'stt'
  toSttConfig(baseDir: string): SttModelConfig
}

export interface VadModelEntry extends DownloadableModel {
  readonly kind: 'vad'
  toVadConfig(baseDir: string): VadModelConfig
}

export type VoiceModelEntry = TtsModelEntry | SttModelEntry | VadModelEntry

const TTS_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

// Every Moonshine model (tiny/base) ships the same 4 files + tokens.
function moonshineConfig(baseDir: string): SttModelConfig {
  return {
    kind: 'moonshine',
    preprocessor: join(baseDir, 'preprocess.onnx'),
    encoder: join(baseDir, 'encode.int8.onnx'),
    uncachedDecoder: join(baseDir, 'uncached_decode.int8.onnx'),
    cachedDecoder: join(baseDir, 'cached_decode.int8.onnx'),
    tokens: join(baseDir, 'tokens.txt'),
  }
}

export const voiceModels: Readonly<Record<string, VoiceModelEntry>> = {
  // Vynel's default voice — 11 natural English speakers, 24 kHz.
  kokoro: {
    kind: 'tts',
    folder: 'kokoro-en-v0_19',
    approxSize: '~340 MB',
    download: { format: 'archive', url: `${TTS_RELEASE}/kokoro-en-v0_19.tar.bz2` },
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
    approxSize: '~61 MB',
    download: { format: 'archive', url: `${TTS_RELEASE}/vits-piper-en_US-lessac-medium.tar.bz2` },
    toTtsConfig: (baseDir) => ({
      kind: 'vits',
      model: join(baseDir, 'en_US-lessac-medium.onnx'),
      tokens: join(baseDir, 'tokens.txt'),
      dataDir: join(baseDir, 'espeak-ng-data'),
    }),
  },
  // The listening side — Moonshine tiny English (int8), the lightest realtime STT.
  moonshine: {
    kind: 'stt',
    folder: 'sherpa-onnx-moonshine-tiny-en-int8',
    approxSize: '~50 MB',
    download: {
      format: 'archive',
      url: `${ASR_RELEASE}/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2`,
    },
    toSttConfig: (baseDir) => moonshineConfig(baseDir),
  },
  // Moonshine base — same architecture, more accurate, still realtime on CPU.
  'moonshine-base': {
    kind: 'stt',
    folder: 'sherpa-onnx-moonshine-base-en-int8',
    approxSize: '~240 MB',
    download: {
      format: 'archive',
      url: `${ASR_RELEASE}/sherpa-onnx-moonshine-base-en-int8.tar.bz2`,
    },
    toSttConfig: (baseDir) => moonshineConfig(baseDir),
  },
  // Voice-activity detection — a single ~630 KB silero model file, 16 kHz.
  'silero-vad': {
    kind: 'vad',
    folder: 'silero-vad',
    approxSize: '~630 KB',
    download: { format: 'file', url: `${ASR_RELEASE}/silero_vad.onnx` },
    toVadConfig: (baseDir) => ({ model: join(baseDir, 'silero_vad.onnx') }),
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
