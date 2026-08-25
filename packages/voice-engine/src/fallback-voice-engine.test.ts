import { describe, it, expect } from 'vitest'
import { FallbackVoiceEngine } from './fallback-voice-engine.js'
import type { PcmAudio, VoiceEngine } from './voice-engine.js'

const primaryAudio: PcmAudio = { samples: new Float32Array([0.1]), sampleRate: 24_000 }
const fallbackAudio: PcmAudio = { samples: new Float32Array([0.9]), sampleRate: 22_050 }

function engineAnswering(audio: PcmAudio): VoiceEngine & { sampleRate: number; voiceCount: number } {
  return { sampleRate: audio.sampleRate, voiceCount: 1, synthesize: async () => audio }
}

describe('FallbackVoiceEngine', () => {
  it('answers from the primary while it works', async () => {
    const engine = new FallbackVoiceEngine({
      primary: engineAnswering(primaryAudio),
      fallback: () => engineAnswering(fallbackAudio),
    })
    expect((await engine.synthesize('Hi')).samples[0]).toBeCloseTo(0.1)
  })

  it('a primary failure falls through to the CURRENT fallback and reports it', async () => {
    const failures: unknown[] = []
    let current = engineAnswering(fallbackAudio)
    const engine = new FallbackVoiceEngine({
      primary: {
        sampleRate: 24_000,
        voiceCount: 1,
        synthesize: async () => {
          throw new Error('provider down')
        },
      },
      fallback: () => current,
      onFallback: (error) => failures.push(error),
    })

    expect((await engine.synthesize('Hi')).samples[0]).toBeCloseTo(0.9)
    expect(failures).toHaveLength(1)

    // The thunk reads the engine of the moment — a reload's swap is honored.
    current = engineAnswering(primaryAudio)
    expect((await engine.synthesize('Hi again')).samples[0]).toBeCloseTo(0.1)
  })

  it('passes the speaker knob through to the fallback voice', async () => {
    const seenOptions: unknown[] = []
    const engine = new FallbackVoiceEngine({
      primary: {
        sampleRate: 24_000,
        voiceCount: 1,
        synthesize: async () => {
          throw new Error('down')
        },
      },
      fallback: () => ({
        synthesize: async (_text, options) => {
          seenOptions.push(options)
          return fallbackAudio
        },
      }),
    })
    await engine.synthesize('Hi', { voiceId: 3 })
    expect(seenOptions).toEqual([{ voiceId: 3 }])
  })
})
