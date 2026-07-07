import { describe, expect, it } from 'vitest'
import { downmixToMono, monoToChannels, resampleLinear } from './audio-format.js'

describe('resampleLinear', () => {
  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })

  it('halves the length when downsampling 2:1', () => {
    const input = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1])
    const out = resampleLinear(input, 32000, 16000)
    expect(out.length).toBe(4)
  })

  it('doubles the length when upsampling 1:2 and interpolates', () => {
    const out = resampleLinear(new Float32Array([0, 1]), 16000, 32000)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0)
  })
})

describe('downmixToMono', () => {
  it('averages stereo frames to mono', () => {
    const stereo = new Float32Array([0, 1, 0.5, 0.5, 1, 0])
    expect(Array.from(downmixToMono(stereo, 2))).toEqual([0.5, 0.5, 0.5])
  })

  it('passes mono through untouched', () => {
    const mono = new Float32Array([0.1, 0.2])
    expect(downmixToMono(mono, 1)).toBe(mono)
  })
})

describe('monoToChannels', () => {
  it('duplicates mono across stereo', () => {
    const out = monoToChannels(new Float32Array([0.3, 0.7]), 2)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(0.3)
    expect(out[2]).toBeCloseTo(0.7)
    expect(out[3]).toBeCloseTo(0.7)
  })
})
