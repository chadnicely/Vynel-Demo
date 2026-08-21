import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getLocalModelOrThrow } from '@vynel/contracts/models/local-model-catalog'
import { resolveSttConfig, resolveTtsConfig, resolveVadConfig } from './model-configs.js'

const MODELS_DIR = join('C:', 'models', 'voice')

describe('model configs from the catalog', () => {
  it('kokoro → its four files under the catalog folder', () => {
    const base = join(MODELS_DIR, 'kokoro-en-v0_19')
    expect(resolveTtsConfig(MODELS_DIR, getLocalModelOrThrow('kokoro'))).toEqual({
      kind: 'kokoro',
      model: join(base, 'model.onnx'),
      voices: join(base, 'voices.bin'),
      tokens: join(base, 'tokens.txt'),
      dataDir: join(base, 'espeak-ng-data'),
    })
  })

  it('piper → a vits config', () => {
    const base = join(MODELS_DIR, 'vits-piper-en_US-lessac-medium')
    expect(resolveTtsConfig(MODELS_DIR, getLocalModelOrThrow('piper-lessac'))).toEqual({
      kind: 'vits',
      model: join(base, 'en_US-lessac-medium.onnx'),
      tokens: join(base, 'tokens.txt'),
      dataDir: join(base, 'espeak-ng-data'),
    })
  })

  it('moonshine sizes share one layout and differ only by folder', () => {
    const tiny = resolveSttConfig(MODELS_DIR, getLocalModelOrThrow('moonshine-tiny'))
    const base = resolveSttConfig(MODELS_DIR, getLocalModelOrThrow('moonshine-base'))
    expect(tiny.encoder).toBe(join(MODELS_DIR, 'sherpa-onnx-moonshine-tiny-en-int8', 'encode.int8.onnx'))
    expect(base.encoder).toBe(join(MODELS_DIR, 'sherpa-onnx-moonshine-base-en-int8', 'encode.int8.onnx'))
    expect(base.kind).toBe('moonshine')
  })

  it('silero → the one file', () => {
    expect(resolveVadConfig(MODELS_DIR, getLocalModelOrThrow('silero-vad'))).toEqual({
      model: join(MODELS_DIR, 'silero-vad', 'silero_vad.onnx'),
    })
  })

  it('refuses a model of the wrong kind, naming it', () => {
    expect(() => resolveTtsConfig(MODELS_DIR, getLocalModelOrThrow('silero-vad'))).toThrow(
      /"silero-vad" is not a TTS model/,
    )
    expect(() => resolveSttConfig(MODELS_DIR, getLocalModelOrThrow('kokoro'))).toThrow(/not a speech-to-text/)
    expect(() => resolveVadConfig(MODELS_DIR, getLocalModelOrThrow('kokoro'))).toThrow(/not a voice-activity/)
  })
})
