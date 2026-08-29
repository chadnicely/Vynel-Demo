import { cpus } from 'node:os'
import { describe, expect, it } from 'vitest'

/** The default follows the machine — cores minus two, floored at 2 — so the
 *  expectation follows it too rather than pinning one box's answer. */
const expectedThreads = Math.max(2, Math.min(8, cpus().length - 2))
import { buildOfflineTtsConfig } from './build-offline-tts-config.js'

describe('buildOfflineTtsConfig', () => {
  it('maps a kokoro model onto the kokoro sub-config with CPU + default threads', () => {
    const config = buildOfflineTtsConfig({
      tts: {
        kind: 'kokoro',
        model: '/m/model.onnx',
        voices: '/m/voices.bin',
        tokens: '/m/tokens.txt',
        dataDir: '/m/espeak-ng-data',
      },
    })

    expect(config).toEqual({
      numThreads: expectedThreads,
      provider: 'cpu',
      model: {
        kokoro: {
          model: '/m/model.onnx',
          voices: '/m/voices.bin',
          tokens: '/m/tokens.txt',
          dataDir: '/m/espeak-ng-data',
        },
      },
    })
  })

  it('maps a vits model onto the vits sub-config', () => {
    const config = buildOfflineTtsConfig({
      tts: {
        kind: 'vits',
        model: '/m/en_US-lessac-medium.onnx',
        tokens: '/m/tokens.txt',
        dataDir: '/m/espeak-ng-data',
      },
    })

    expect(config.model).toEqual({
      vits: {
        model: '/m/en_US-lessac-medium.onnx',
        tokens: '/m/tokens.txt',
        dataDir: '/m/espeak-ng-data',
      },
    })
  })

  it('honours numThreads, maxNumSentences, and lengthScale overrides', () => {
    const config = buildOfflineTtsConfig({
      tts: {
        kind: 'kokoro',
        model: '/m/model.onnx',
        voices: '/m/voices.bin',
        tokens: '/m/tokens.txt',
        dataDir: '/m/espeak-ng-data',
        lengthScale: 1.1,
      },
      numThreads: 4,
      maxNumSentences: 2,
    })

    expect(config.numThreads).toBe(4)
    expect(config.maxNumSentences).toBe(2)
    expect(config.model?.kokoro?.lengthScale).toBe(1.1)
  })

  it('omits optional keys rather than setting them undefined (exactOptionalPropertyTypes)', () => {
    const config = buildOfflineTtsConfig({
      tts: {
        kind: 'vits',
        model: '/m/model.onnx',
        tokens: '/m/tokens.txt',
        dataDir: '/m/espeak-ng-data',
      },
    })

    expect('maxNumSentences' in config).toBe(false)
    expect('lengthScale' in (config.model?.vits ?? {})).toBe(false)
  })

  it('throws for an unknown model kind (internal invariant, not user input)', () => {
    const rogue = { kind: 'lux-python', model: '/m/x' } as unknown as Parameters<
      typeof buildOfflineTtsConfig
    >[0]['tts']

    expect(() => buildOfflineTtsConfig({ tts: rogue })).toThrow(/Unsupported TTS model kind/)
  })
})
