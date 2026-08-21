import type { Logger } from 'pino'
import { getLocalModelOrThrow } from '@vynel/contracts/models/local-model-catalog'
import type { VoiceReloadOutcome } from '@vynel/contracts/voice/voice-reload'
import {
  SherpaSpeechRecognizer,
  SherpaVoiceEngine,
  type SpeechRecognizer,
  type VoiceEngine,
} from '@vynel/voice-engine'
import { findMissingModelFile, resolveVoiceModelConfigs, type VoiceModelConfigs } from './models.js'
import { planVoiceReload, type VoiceSelection } from './voice-selection.js'

// The daemon's native TTS + STT engines behind ONE holder, so the user's pick
// can change while the daemon runs: a reload re-creates only the engine whose
// model changed (and is on the disk) and swaps it in between calls — the
// serialized lanes in main.ts read the holder at call time, never a captured
// engine. Genuinely stateful, hence a class.
export class VoiceEngines {
  #synthesizer: VoiceEngine & { readonly voiceCount: number; readonly sampleRate: number }
  #recognizer: SpeechRecognizer
  #selection: VoiceSelection
  #configs: VoiceModelConfigs
  readonly #modelsDir: string
  readonly #logger: Logger

  private constructor(modelsDir: string, selection: VoiceSelection, logger: Logger) {
    this.#modelsDir = modelsDir
    this.#selection = selection
    this.#logger = logger
    this.#configs = resolveVoiceModelConfigs({
      modelsDir,
      ttsModelId: selection.ttsModelId,
      sttModelId: selection.sttModelId,
    })
    this.#synthesizer = new SherpaVoiceEngine({ tts: this.#configs.tts })
    this.#recognizer = new SherpaSpeechRecognizer({ stt: this.#configs.stt })
  }

  /** Load the selection's models. The first missing file, if any, is the
   *  error — so boot can say which download is owed instead of a native crash. */
  static load(modelsDir: string, selection: VoiceSelection, logger: Logger): VoiceEngines {
    const configs = resolveVoiceModelConfigs({
      modelsDir,
      ttsModelId: selection.ttsModelId,
      sttModelId: selection.sttModelId,
    })
    const missing = findMissingModelFile(modelsDir, configs.entries)
    if (missing !== null) throw new VoiceModelMissingError(missing)
    return new VoiceEngines(modelsDir, selection, logger)
  }

  get synthesizer() {
    return this.#synthesizer
  }

  get recognizer(): SpeechRecognizer {
    return this.#recognizer
  }

  get selection(): VoiceSelection {
    return this.#selection
  }

  get vadConfig() {
    return this.#configs.vad
  }

  /** Apply a new pick. A model that is not on the disk is reported missing and
   *  the engine in use stays — the daemon never goes mute over a pick. */
  apply(next: VoiceSelection): VoiceReloadOutcome {
    const plan = planVoiceReload(this.#selection, next, (modelId) =>
      findMissingModelFile(this.#modelsDir, [getLocalModelOrThrow(modelId)]) === null,
    )
    const changed: string[] = []
    if (plan.swapTts || plan.swapStt) {
      const configs = resolveVoiceModelConfigs({
        modelsDir: this.#modelsDir,
        ttsModelId: plan.selection.ttsModelId,
        sttModelId: plan.selection.sttModelId,
      })
      if (plan.swapTts) {
        this.#logger.info({ tts: plan.selection.ttsModelId }, 'voice reload: loading the new voice')
        this.#synthesizer = new SherpaVoiceEngine({ tts: configs.tts })
        changed.push('tts')
      }
      if (plan.swapStt) {
        this.#logger.info({ stt: plan.selection.sttModelId }, 'voice reload: loading the new ears')
        this.#recognizer = new SherpaSpeechRecognizer({ stt: configs.stt })
        changed.push('stt')
      }
      this.#configs = configs
    }
    this.#selection = plan.selection
    return { ...plan.selection, changed, missing: plan.missing }
  }
}

export class VoiceModelMissingError extends Error {
  constructor(readonly missingPath: string) {
    super(`voice model file missing: ${missingPath}`)
    this.name = 'VoiceModelMissingError'
  }
}
