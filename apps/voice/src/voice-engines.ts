import type { Logger } from 'pino'
import { getLocalModelOrThrow } from '@vynel/contracts/models/local-model-catalog'
import type { VoiceReloadOutcome } from '@vynel/contracts/voice/voice-reload'
import {
  FallbackVoiceEngine,
  SherpaSpeechRecognizer,
  SherpaVoiceEngine,
  type SpeechRecognizer,
  type SynthesizeOptions,
  type VoiceEngine,
} from '@vynel/voice-engine'
import { serializeAsync } from './call/serialize-async.js'
import { EngineRelaySpeechRecognizer, EngineRelayVoiceEngine } from './engine-relay-engines.js'
import { findMissingModelFile, resolveVoiceModelConfigs, type VoiceModelConfigs } from './models.js'
import { planVoiceReload, type VoiceSelection } from './voice-selection.js'

export interface VoiceEngineRelayOptions {
  /** The engine's base URL — the relays' `/voice/provider-synthesize` and
   *  `/voice/transcribe` doors live there. */
  readonly apiUrl: string
  readonly fetchImplementation?: typeof fetch
}

// The daemon's TTS + STT engines behind ONE holder, so the user's pick can
// change while the daemon runs. The sherpa pair is ALWAYS loaded — the wake
// line is pinned local and the local voice is the never-silent fallback —
// while the provider-backed halves are stateless HTTP relays to the engine
// (constructed once; the engine resolves provider + voice per request). So a
// reload re-creates only the sherpa engine whose model changed and is on the
// disk, and a source flip is pure getter rewiring — the shared lanes in
// main.ts read the holder at call time, never a captured engine. Genuinely
// stateful, hence a class.
export class VoiceEngines {
  #sherpaSynthesizer: SherpaVoiceEngine
  #sherpaRecognizer: SherpaSpeechRecognizer
  readonly #sherpaLane: VoiceEngine
  readonly #relaySynthesizer: VoiceEngine & { readonly voiceCount: number; readonly sampleRate: number }
  readonly #relayRecognizer: EngineRelaySpeechRecognizer
  #selection: VoiceSelection
  #configs: VoiceModelConfigs
  readonly #modelsDir: string
  readonly #logger: Logger

  private constructor(
    modelsDir: string,
    selection: VoiceSelection,
    logger: Logger,
    relay: VoiceEngineRelayOptions,
  ) {
    this.#modelsDir = modelsDir
    this.#selection = selection
    this.#logger = logger
    this.#configs = resolveVoiceModelConfigs({
      modelsDir,
      ttsModelId: selection.ttsModelId,
      sttModelId: selection.sttModelId,
    })
    this.#sherpaSynthesizer = new SherpaVoiceEngine({ tts: this.#configs.tts })
    this.#sherpaRecognizer = new SherpaSpeechRecognizer({ stt: this.#configs.stt })
    // The serialized lane in front of the NATIVE synthesizer — the sherpa
    // addon is one instance shared by the wake line, every call loop, and the
    // overlay door, and it cannot take concurrent calls. A provider relay is
    // plain HTTP and needs no mutex, so only the native half rides this lane —
    // including the relay's local FALLBACK below, so a failed cloud line can
    // never race a native call. Reads the engine at call time: a reload's swap
    // lands between calls.
    this.#sherpaLane = {
      synthesize: serializeAsync((text: string, options?: SynthesizeOptions) =>
        this.#sherpaSynthesizer.synthesize(text, options),
      ),
    }
    this.#relaySynthesizer = new FallbackVoiceEngine({
      primary: new EngineRelayVoiceEngine(relay.apiUrl, relay.fetchImplementation),
      // A thunk: a reload may swap the local engine under the wrapper.
      fallback: () => this.#sherpaLane,
      onFallback: (error) =>
        this.#logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'cloud voice failed — speaking with the local voice instead',
        ),
    })
    this.#relayRecognizer = new EngineRelaySpeechRecognizer(relay.apiUrl, relay.fetchImplementation)
  }

  /** Load the selection's LOCAL models (required whatever the sources say —
   *  wake + fallback). The first missing file, if any, is the error — so boot
   *  can say which download is owed instead of a native crash. */
  static load(
    modelsDir: string,
    selection: VoiceSelection,
    logger: Logger,
    relay: VoiceEngineRelayOptions,
  ): VoiceEngines {
    const configs = resolveVoiceModelConfigs({
      modelsDir,
      ttsModelId: selection.ttsModelId,
      sttModelId: selection.sttModelId,
    })
    const missing = findMissingModelFile(modelsDir, configs.entries)
    if (missing !== null) throw new VoiceModelMissingError(missing)
    return new VoiceEngines(modelsDir, selection, logger, relay)
  }

  get synthesizer(): VoiceEngine {
    return this.#selection.ttsSource === 'local' ? this.#sherpaLane : this.#relaySynthesizer
  }

  /** The WAKE recognizer — pinned to the local model: the always-on mic never
   *  streams the room to a cloud API, whatever the hearing source says. */
  get recognizer(): SpeechRecognizer {
    return this.#sherpaRecognizer
  }

  /** The IN-SESSION recognizer (commands after wake, call legs) — the relay
   *  when a provider is the hearing source, the local model otherwise
   *  ('web-speech' is a browser-leg concern; natively it means local). */
  get sessionRecognizer(): SpeechRecognizer {
    const source = this.#selection.sttSource
    return source === 'web-speech' || source === 'local'
      ? this.#sherpaRecognizer
      : this.#relayRecognizer
  }

  get selection(): VoiceSelection {
    return this.#selection
  }

  get vadConfig() {
    return this.#configs.vad
  }

  /** Apply a new pick. A local model that is not on the disk is reported
   *  missing and the engine in use stays — the daemon never goes mute over a
   *  pick. Source flips always land (the relays gate nothing on disk). */
  apply(next: VoiceSelection): Omit<VoiceReloadOutcome, 'ready'> {
    const plan = planVoiceReload(this.#selection, next, (modelId) =>
      isVoiceModelInstalled(this.#modelsDir, modelId),
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
        this.#sherpaSynthesizer = new SherpaVoiceEngine({ tts: configs.tts })
        changed.push('tts')
      }
      if (plan.swapStt) {
        this.#logger.info({ stt: plan.selection.sttModelId }, 'voice reload: loading the new ears')
        this.#sherpaRecognizer = new SherpaSpeechRecognizer({ stt: configs.stt })
        changed.push('stt')
      }
      this.#configs = configs
    }
    if (plan.selection.ttsSource !== this.#selection.ttsSource && !changed.includes('tts')) {
      changed.push('tts')
    }
    if (plan.selection.sttSource !== this.#selection.sttSource && !changed.includes('stt')) {
      changed.push('stt')
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

/** Every file of one catalog model is on the disk — the reload planner's and
 *  the slot's one answer to "can this pick load". */
export function isVoiceModelInstalled(modelsDir: string, modelId: string): boolean {
  return findMissingModelFile(modelsDir, [getLocalModelOrThrow(modelId)]) === null
}
