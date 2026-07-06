import { describe, expect, it } from 'vitest'
import { buildVadConfig } from './build-vad-config.js'

describe('buildVadConfig', () => {
  it('fixes 16 kHz + CPU and passes the model path through', () => {
    const config = buildVadConfig({ vad: { model: '/m/silero_vad.onnx' } })

    expect(config).toEqual({
      sileroVad: { model: '/m/silero_vad.onnx' },
      sampleRate: 16000,
      numThreads: 1,
      provider: 'cpu',
    })
  })

  it('passes tuning knobs through when set', () => {
    const config = buildVadConfig({
      vad: {
        model: '/m/silero_vad.onnx',
        threshold: 0.6,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 12,
      },
      numThreads: 2,
    })

    expect(config.sileroVad).toEqual({
      model: '/m/silero_vad.onnx',
      threshold: 0.6,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.25,
      maxSpeechDuration: 12,
    })
    expect(config.numThreads).toBe(2)
  })

  it('omits unset knobs so the model defaults win (exactOptionalPropertyTypes)', () => {
    const config = buildVadConfig({ vad: { model: '/m/silero_vad.onnx' } })
    expect('threshold' in (config.sileroVad ?? {})).toBe(false)
    expect('minSilenceDuration' in (config.sileroVad ?? {})).toBe(false)
  })
})
