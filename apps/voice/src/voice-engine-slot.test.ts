import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { VoiceModelMissingError, type VoiceEngines } from './voice-engines.js'
import { VoiceEngineSlot, VoiceNotReadyError } from './voice-engine-slot.js'
import type { VoiceSelection } from './voice-selection.js'

const silentLogger = pino({ level: 'silent' })
const PICK: VoiceSelection = {
  ttsSource: 'local',
  sttSource: 'web-speech',
  ttsModelId: 'kokoro',
  sttModelId: 'moonshine-base',
  speakerId: 2,
}
const ENV_MODELS: VoiceSelection = {
  ttsSource: 'local',
  sttSource: 'web-speech',
  ttsModelId: 'piper-lessac',
  sttModelId: 'moonshine-tiny',
  speakerId: 0,
}

/** Stands in for the native engines: records applies, never touches sherpa. */
function fakeEngines(selection: VoiceSelection): VoiceEngines & { applied: VoiceSelection[] } {
  const applied: VoiceSelection[] = []
  return {
    applied,
    selection,
    apply: (next: VoiceSelection) => {
      applied.push(next)
      return { ...next, changed: ['tts'], missing: [] }
    },
  } as unknown as VoiceEngines & { applied: VoiceSelection[] }
}

/** A loader + installed-check over a set of model ids "on the disk". */
function diskWith(installed: Set<string>) {
  return {
    isInstalled: (modelId: string) => installed.has(modelId),
    load: (selection: VoiceSelection) => {
      for (const modelId of [selection.ttsModelId, selection.sttModelId]) {
        if (!installed.has(modelId)) throw new VoiceModelMissingError(`/models/${modelId}/model.onnx`)
      }
      return fakeEngines(selection)
    },
  }
}

describe('VoiceEngineSlot', () => {
  it('starts empty when nothing is installed, and says so to anyone who needs a voice now', () => {
    const slot = new VoiceEngineSlot(silentLogger, { modelsDir: '/models', fallback: ENV_MODELS, ...diskWith(new Set()) })
    expect(slot.tryLoad(PICK)).toBe(false)
    expect(slot.isReady).toBe(false)
    expect(() => slot.engines).toThrow(VoiceNotReadyError)
    expect(slot.apply(PICK)).toEqual({ ...PICK, changed: [], missing: ['kokoro', 'moonshine-base'], ready: false })
  })

  it('names only the picked models that are missing', () => {
    const slot = new VoiceEngineSlot(silentLogger, {
      modelsDir: '/models',
      fallback: ENV_MODELS,
      ...diskWith(new Set(['kokoro'])),
    })
    expect(slot.apply(PICK)).toEqual({ ...PICK, changed: [], missing: ['moonshine-base'], ready: false })
  })

  it('falls back to the env models with the pick’s speaker when the pick is not on the disk', () => {
    const slot = new VoiceEngineSlot(silentLogger, {
      modelsDir: '/models',
      fallback: ENV_MODELS,
      ...diskWith(new Set(['piper-lessac', 'moonshine-tiny'])),
    })
    expect(slot.tryLoad(PICK)).toBe(true)
    expect(slot.engines.selection).toEqual({ ...ENV_MODELS, speakerId: 2 })
  })

  it('fills on the first apply once the models are there — through the fallback too — then swaps through the engines', () => {
    const installed = new Set<string>()
    const slot = new VoiceEngineSlot(silentLogger, { modelsDir: '/models', fallback: ENV_MODELS, ...diskWith(installed) })
    expect(slot.tryLoad(PICK)).toBe(false)

    // The user downloaded the env models, not the saved pick: a voice anyway,
    // and the outcome is honest about which picked models are still owed.
    installed.add('piper-lessac').add('moonshine-tiny')
    expect(slot.apply(PICK)).toEqual({
      ...ENV_MODELS,
      speakerId: 2,
      changed: ['tts', 'stt'],
      missing: ['kokoro', 'moonshine-base'],
      ready: true,
    })
    expect(slot.isReady).toBe(true)

    const engines = slot.engines as ReturnType<typeof fakeEngines>
    const next = { ...PICK, ttsModelId: 'piper-lessac' as const }
    expect(slot.apply(next)).toEqual({ ...next, changed: ['tts'], missing: [], ready: true })
    expect(engines.applied).toEqual([next])
  })

  it('does not retry the fallback when it IS the pick', () => {
    let loads = 0
    const slot = new VoiceEngineSlot(silentLogger, {
      modelsDir: '/models',
      fallback: PICK,
      isInstalled: () => false,
      load: () => {
        loads += 1
        throw new VoiceModelMissingError('/models/x')
      },
    })
    expect(slot.tryLoad({ ...PICK, speakerId: 5 })).toBe(false)
    expect(loads).toBe(1)
  })

  it('lets a real load failure propagate', () => {
    const slot = new VoiceEngineSlot(silentLogger, {
      modelsDir: '/models',
      fallback: ENV_MODELS,
      isInstalled: () => true,
      load: () => {
        throw new Error('addon exploded')
      },
    })
    expect(() => slot.tryLoad(PICK)).toThrow('addon exploded')
  })
})
