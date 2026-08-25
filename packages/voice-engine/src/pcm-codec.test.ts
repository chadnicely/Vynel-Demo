import { describe, it, expect } from 'vitest'
import { decodeWavToPcm, encodeWavFromPcm, int16BytesToFloat32 } from './pcm-codec.js'

describe('pcm-codec', () => {
  it('round-trips PCM through WAV within 16-bit precision', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123])
    const decoded = decodeWavToPcm(encodeWavFromPcm({ samples, sampleRate: 24_000 }))

    expect(decoded.sampleRate).toBe(24_000)
    expect(decoded.samples.length).toBe(samples.length)
    for (let index = 0; index < samples.length; index += 1) {
      expect(Math.abs(decoded.samples[index]! - samples[index]!)).toBeLessThan(1 / 32_000)
    }
  })

  it('walks past extra RIFF chunks before data (providers append LIST chunks)', () => {
    const wav = encodeWavFromPcm({ samples: new Float32Array([0.25]), sampleRate: 16_000 })
    // Splice a 4-byte LIST chunk between fmt and data.
    const listChunk = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4])
    const spliced = new Uint8Array(wav.length + listChunk.length)
    spliced.set(wav.subarray(0, 36), 0)
    spliced.set(listChunk, 36)
    spliced.set(wav.subarray(36), 36 + listChunk.length)
    // RIFF size field grows by the spliced chunk.
    new DataView(spliced.buffer).setUint32(4, spliced.length - 8, true)

    const decoded = decodeWavToPcm(spliced)
    expect(decoded.sampleRate).toBe(16_000)
    expect(decoded.samples.length).toBe(1)
  })

  it('rejects non-RIFF bytes and non-mono formats loudly', () => {
    expect(() => decodeWavToPcm(new Uint8Array(100))).toThrow('not a RIFF/WAVE stream')

    const stereo = encodeWavFromPcm({ samples: new Float32Array([0, 0]), sampleRate: 24_000 })
    new DataView(stereo.buffer).setUint16(22, 2, true)
    expect(() => decodeWavToPcm(stereo)).toThrow('expected mono 16-bit PCM')
  })

  it('maps raw 16-bit little-endian bytes to [-1, 1] floats', () => {
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setInt16(0, 0, true)
    view.setInt16(2, 16_384, true)
    view.setInt16(4, -32_768, true)

    const samples = int16BytesToFloat32(bytes)
    expect(samples[0]).toBe(0)
    expect(samples[1]).toBeCloseTo(0.5, 3)
    expect(samples[2]).toBe(-1)
  })
})
