import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  VAD_MODEL_ID,
  getLocalModelOrThrow,
  requiredModelFiles,
  type LocalModelEntry,
} from '@vynel/contracts/models/local-model-catalog'
import {
  resolveSttConfig,
  resolveTtsConfig,
  resolveVadConfig,
  type SttModelConfig,
  type TtsModelConfig,
  type VadModelConfig,
} from '@vynel/voice-engine'

// The daemon's three models, resolved from the catalog the Settings screen and
// the downloader read — one layout, one set of ids (`VYNEL_VOICE_TTS` /
// `VYNEL_VOICE_STT` are catalog ids).

export interface VoiceModelSelection {
  readonly modelsDir: string
  readonly ttsModelId: string
  readonly sttModelId: string
}

export interface VoiceModelConfigs {
  readonly tts: TtsModelConfig
  readonly stt: SttModelConfig
  readonly vad: VadModelConfig
  readonly entries: readonly LocalModelEntry[]
}

export function resolveVoiceModelConfigs(selection: VoiceModelSelection): VoiceModelConfigs {
  const tts = getLocalModelOrThrow(selection.ttsModelId)
  const stt = getLocalModelOrThrow(selection.sttModelId)
  const vad = getLocalModelOrThrow(VAD_MODEL_ID)
  return {
    tts: resolveTtsConfig(selection.modelsDir, tts),
    stt: resolveSttConfig(selection.modelsDir, stt),
    vad: resolveVadConfig(selection.modelsDir, vad),
    entries: [tts, stt, vad],
  }
}

/** The first required model path that is missing, or null when everything is
 *  in place — so main can fail with a clear "download it in Settings → Voice /
 *  run pnpm voice:fetch-models" instead of a cryptic native load error. */
export function findMissingModelFile(modelsDir: string, entries: readonly LocalModelEntry[]): string | null {
  for (const entry of entries) {
    const base = join(modelsDir, ...entry.folder.split('/'))
    for (const relative of requiredModelFiles(entry)) {
      const path = join(base, ...relative.split('/'))
      if (!existsSync(path)) return path
    }
  }
  return null
}
