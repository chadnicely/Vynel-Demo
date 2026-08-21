import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STT_MODEL_ID,
  DEFAULT_TTS_MODEL_ID,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_MODELS,
  LOCAL_STT_MODEL_IDS,
  LOCAL_TTS_MODEL_IDS,
  VAD_MODEL_ID,
  findLocalModel,
  getLocalModelOrThrow,
  requiredModelFiles,
} from './local-model-catalog.js'

// The catalog is data the whole app trusts: ids unique, every id the env and
// the defaults name really exists, every layout yields the files a probe checks.
describe('local model catalog', () => {
  it('has unique ids and a folder per model', () => {
    const ids = LOCAL_MODELS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of LOCAL_MODELS) expect(entry.folder.length).toBeGreaterThan(0)
  })

  it('the id lists and defaults name real models of the right kind', () => {
    for (const id of LOCAL_TTS_MODEL_IDS) expect(getLocalModelOrThrow(id).kind).toBe('tts')
    for (const id of LOCAL_STT_MODEL_IDS) expect(getLocalModelOrThrow(id).kind).toBe('stt')
    expect(getLocalModelOrThrow(DEFAULT_TTS_MODEL_ID).kind).toBe('tts')
    expect(getLocalModelOrThrow(DEFAULT_STT_MODEL_ID).kind).toBe('stt')
    expect(getLocalModelOrThrow(VAD_MODEL_ID).kind).toBe('vad')
    expect(LOCAL_EMBEDDING_MODEL.kind).toBe('embedding')
  })

  it('every TTS model names its speakers, with id 0 present', () => {
    for (const entry of LOCAL_MODELS.filter((row) => row.kind === 'tts')) {
      expect(entry.speakers?.some((speaker) => speaker.id === 0)).toBe(true)
    }
    expect(getLocalModelOrThrow('kokoro').speakers).toHaveLength(11)
  })

  it('derives the required files from each layout', () => {
    expect(requiredModelFiles(LOCAL_EMBEDDING_MODEL)).toEqual([
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model_quantized.onnx',
    ])
    expect(requiredModelFiles(getLocalModelOrThrow('kokoro'))).toContain('voices.bin')
    expect(requiredModelFiles(getLocalModelOrThrow('moonshine-base'))).toHaveLength(5)
    expect(requiredModelFiles(getLocalModelOrThrow('silero-vad'))).toEqual(['silero_vad.onnx'])
  })

  it('unknown ids answer null, or throw with the known list', () => {
    expect(findLocalModel('nope')).toBeNull()
    expect(() => getLocalModelOrThrow('nope')).toThrow(/Known models: minilm-l6-v2, kokoro/)
  })
})
