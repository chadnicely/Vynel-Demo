import { join } from 'node:path'
import type { LocalModelEntry } from '@vynel/contracts/models/local-model-catalog'
import type { SttModelConfig, TtsModelConfig, VadModelConfig } from './voice-engine.js'

// From a catalog entry + the models directory to the file paths the sherpa
// engines open. The catalog's layout is the one list of file names; this only
// joins them — so the probe (`@vynel/models`) and the loader agree by
// construction, and the daemon and the dev scripts stop carrying their own
// copies of the layout.

function modelDir(modelsDir: string, entry: LocalModelEntry): string {
  return join(modelsDir, ...entry.folder.split('/'))
}

export function resolveTtsConfig(modelsDir: string, entry: LocalModelEntry): TtsModelConfig {
  const layout = entry.layout
  const base = modelDir(modelsDir, entry)
  switch (layout.family) {
    case 'kokoro':
      return {
        kind: 'kokoro',
        model: join(base, layout.model),
        voices: join(base, layout.voices),
        tokens: join(base, layout.tokens),
        dataDir: join(base, layout.dataDir),
      }
    case 'vits':
      return {
        kind: 'vits',
        model: join(base, layout.model),
        tokens: join(base, layout.tokens),
        dataDir: join(base, layout.dataDir),
      }
    default:
      throw new Error(`@vynel/voice-engine: "${entry.id}" is not a TTS model (${layout.family}).`)
  }
}

export function resolveSttConfig(modelsDir: string, entry: LocalModelEntry): SttModelConfig {
  const layout = entry.layout
  if (layout.family !== 'moonshine') {
    throw new Error(`@vynel/voice-engine: "${entry.id}" is not a speech-to-text model (${layout.family}).`)
  }
  const base = modelDir(modelsDir, entry)
  return {
    kind: 'moonshine',
    preprocessor: join(base, layout.preprocessor),
    encoder: join(base, layout.encoder),
    uncachedDecoder: join(base, layout.uncachedDecoder),
    cachedDecoder: join(base, layout.cachedDecoder),
    tokens: join(base, layout.tokens),
  }
}

export function resolveVadConfig(modelsDir: string, entry: LocalModelEntry): VadModelConfig {
  const layout = entry.layout
  if (layout.family !== 'silero') {
    throw new Error(`@vynel/voice-engine: "${entry.id}" is not a voice-activity model (${layout.family}).`)
  }
  return { model: join(modelDir(modelsDir, entry), layout.model) }
}
