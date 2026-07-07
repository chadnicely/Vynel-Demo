import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav-encode.js'

describe('encodeWav', () => {
  it('writes a valid 16-bit mono WAV header + samples', () => {
    const wav = encodeWav({ samples: new Float32Array([0, 0.5, -0.5, 1, -1]), sampleRate: 24_000 })
    const view = new DataView(wav.buffer)

    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(24_000)
    expect(view.getUint32(40, true)).toBe(10) // 5 samples × 2 bytes
    expect(wav.length).toBe(44 + 10)

    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767))
    expect(view.getInt16(50, true)).toBe(32767) // clamped full-scale
    expect(view.getInt16(52, true)).toBe(-32767)
  })
})
