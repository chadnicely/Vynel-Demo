import type { Logger } from 'pino'
import type { VoiceReloadOutcome } from '@vynel/contracts/voice/voice-reload'
import {
  VoiceEngines,
  VoiceModelMissingError,
  isVoiceModelInstalled,
  type VoiceEngineRelayOptions,
} from './voice-engines.js'
import type { VoiceSelection } from './voice-selection.js'

/** The daemon is up but has no voice yet — every model it would speak or
 *  hear with is still to be downloaded (Settings → Voice). */
export class VoiceNotReadyError extends Error {
  constructor() {
    super('No voice model is installed yet — download one in Settings → Voice.')
    this.name = 'VoiceNotReadyError'
  }
}

export interface VoiceEngineLoader {
  (selection: VoiceSelection): VoiceEngines
}

export interface VoiceEngineSlotOptions {
  modelsDir: string
  /** The env models — tried whenever the user's pick is not on the disk, so
   *  a pick whose files are gone (or not yet downloaded) still leaves the
   *  daemon with whatever voice IS installed. */
  fallback: VoiceSelection
  /** Where the provider-backed halves relay to (the engine's cloud doors).
   *  Required unless a custom `load` is injected. */
  relay?: VoiceEngineRelayOptions
  load?: VoiceEngineLoader
  isInstalled?: (modelId: string) => boolean
}

// The engines the daemon MAY have. An installed app boots before any voice
// model exists on the machine (Kafi, 2026-08-22: "boot idle, load on
// download"), so the slot starts empty, the overlay channel still comes up
// (the engine's relay connects, the dock can wake the app), synthesis says
// honestly that there is no voice yet, and the first `/reload` after a
// download fills the slot — no restart. Genuinely stateful, hence a class.
export class VoiceEngineSlot {
  #engines: VoiceEngines | null = null
  readonly #fallback: VoiceSelection
  readonly #load: VoiceEngineLoader
  readonly #isInstalled: (modelId: string) => boolean
  readonly #logger: Logger

  constructor(logger: Logger, options: VoiceEngineSlotOptions) {
    this.#logger = logger
    this.#fallback = options.fallback
    this.#load =
      options.load ??
      ((selection) => {
        if (options.relay === undefined) {
          throw new Error('VoiceEngineSlot: relay options are required without a custom loader')
        }
        return VoiceEngines.load(options.modelsDir, selection, logger, options.relay)
      })
    this.#isInstalled =
      options.isInstalled ?? ((modelId) => isVoiceModelInstalled(options.modelsDir, modelId))
  }

  get isReady(): boolean {
    return this.#engines !== null
  }

  /** The loaded engines — or the typed "no voice yet" for a caller that
   *  needs them now (synthesis, transcription). */
  get engines(): VoiceEngines {
    if (this.#engines === null) throw new VoiceNotReadyError()
    return this.#engines
  }

  /** Fill an empty slot: the pick first, then the fallback models with the
   *  pick's speaker. Answers whether there is a voice now; a full slot is
   *  left as it is. A missing model is expected; any other failure is real
   *  and propagates. */
  tryLoad(selection: VoiceSelection): boolean {
    if (this.#engines !== null) return true
    if (this.#loadOnce(selection)) return true
    const fallback = { ...this.#fallback, speakerId: selection.speakerId }
    const fallbackIsThePick =
      fallback.ttsModelId === selection.ttsModelId && fallback.sttModelId === selection.sttModelId
    return !fallbackIsThePick && this.#loadOnce(fallback)
  }

  /** Apply a pick: fill an empty slot when its models (or the fallback's)
   *  are there, or swap what changed in a full one. `ready` says whether
   *  there is a voice now; `missing` names the picked models not on disk. */
  apply(selection: VoiceSelection): VoiceReloadOutcome {
    if (this.#engines !== null) return { ...this.#engines.apply(selection), ready: true }
    const missing = [selection.ttsModelId, selection.sttModelId].filter(
      (modelId) => !this.#isInstalled(modelId),
    )
    if (!this.tryLoad(selection)) return { ...selection, changed: [], missing, ready: false }
    return { ...this.engines.selection, changed: ['tts', 'stt'], missing, ready: true }
  }

  #loadOnce(selection: VoiceSelection): boolean {
    try {
      this.#logger.info({ tts: selection.ttsModelId, stt: selection.sttModelId }, 'loading voice models on CPU…')
      this.#engines = this.#load(selection)
      return true
    } catch (error) {
      if (!(error instanceof VoiceModelMissingError)) throw error
      this.#logger.warn({ missing: error.missingPath }, 'voice model not on the disk')
      return false
    }
  }
}
