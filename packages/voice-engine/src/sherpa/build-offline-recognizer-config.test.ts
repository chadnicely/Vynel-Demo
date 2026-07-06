import { describe, expect, it } from 'vitest'
import { buildOfflineRecognizerConfig } from './build-offline-recognizer-config.js'

const moonshine = {
  kind: 'moonshine',
  preprocessor: '/m/preprocess.onnx',
  encoder: '/m/encode.int8.onnx',
  uncachedDecoder: '/m/uncached_decode.int8.onnx',
  cachedDecoder: '/m/cached_decode.int8.onnx',
  tokens: '/m/tokens.txt',
} as const

describe('buildOfflineRecognizerConfig', () => {
  it('maps a moonshine model onto the moonshine sub-config with CPU + default threads', () => {
    const config = buildOfflineRecognizerConfig({ stt: moonshine })

    expect(config).toEqual({
      modelConfig: {
        moonshine: {
          preprocessor: '/m/preprocess.onnx',
          encoder: '/m/encode.int8.onnx',
          uncachedDecoder: '/m/uncached_decode.int8.onnx',
          cachedDecoder: '/m/cached_decode.int8.onnx',
        },
        tokens: '/m/tokens.txt',
        numThreads: 2,
        provider: 'cpu',
      },
    })
  })

  it('honours a numThreads override', () => {
    const config = buildOfflineRecognizerConfig({ stt: moonshine, numThreads: 4 })
    expect(config.modelConfig?.numThreads).toBe(4)
  })

  it('throws for an unknown model kind (internal invariant, not user input)', () => {
    const rogue = { kind: 'whisper-slow' } as unknown as Parameters<
      typeof buildOfflineRecognizerConfig
    >[0]['stt']

    expect(() => buildOfflineRecognizerConfig({ stt: rogue })).toThrow(/Unsupported STT model kind/)
  })
})
