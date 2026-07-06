import { join } from 'node:path'
import type { TtsModelConfig } from '@vynel/voice-engine'

// The registry of downloadable sherpa-onnx TTS models. Each entry knows its
// release archive and how to turn an extracted folder into a Vynel
// `TtsModelConfig`. `fetch-voice-models` downloads by name; `synthesize-smoke`
// loads by name. Add ZipVoice (voice-cloning) / Chatterbox entries here as we
// adopt them — the engine contract already accepts them.

export interface VoiceModelEntry {
  /** Top-level folder the archive extracts to, under `.models/voice/`. */
  readonly folder: string
  /** The sherpa-onnx `tts-models` release `.tar.bz2` URL. */
  readonly archiveUrl: string
  /** Approximate download size, shown before a long fetch. */
  readonly approxSize: string
  /** Build the engine config from the extracted model's base dir. */
  toTtsConfig(baseDir: string): TtsModelConfig
}

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'

export const voiceModels: Readonly<Record<string, VoiceModelEntry>> = {
  // Vynel's default voice — 11 natural English speakers, 24 kHz.
  kokoro: {
    folder: 'kokoro-en-v0_19',
    archiveUrl: `${RELEASE}/kokoro-en-v0_19.tar.bz2`,
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
    folder: 'vits-piper-en_US-lessac-medium',
    archiveUrl: `${RELEASE}/vits-piper-en_US-lessac-medium.tar.bz2`,
    approxSize: '~61 MB',
    toTtsConfig: (baseDir) => ({
      kind: 'vits',
      model: join(baseDir, 'en_US-lessac-medium.onnx'),
      tokens: join(baseDir, 'tokens.txt'),
      dataDir: join(baseDir, 'espeak-ng-data'),
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
    throw new Error(`Unknown voice model "${name}". Known models: ${known}.`)
  }
  return entry
}
