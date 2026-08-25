// Pure PCM ↔ WAV codec for the cloud backends: ElevenLabs answers raw
// 16-bit PCM, Google answers WAV-headered LINEAR16, and both STT APIs take
// a WAV upload — all of it meets the engine world as `PcmAudio` (Float32,
// mono). No native deps: `sherpa/wave-file.ts` is the sherpa-native file
// I/O pair; this is the in-memory wire codec.

import type { PcmAudio } from './voice-engine.js'

const WAV_HEADER_BYTES = 44
const RIFF_CHUNK_HEADER_BYTES = 8

/** Mono 16-bit little-endian WAV bytes for `pcm` — the upload/wire shape. */
export function encodeWavFromPcm(pcm: PcmAudio): Uint8Array {
  const sampleCount = pcm.samples.length
  const dataBytes = sampleCount * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, pcm.sampleRate, true)
  view.setUint32(28, pcm.sampleRate * 2, true) // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let index = 0; index < sampleCount; index += 1) {
    const clamped = Math.max(-1, Math.min(1, pcm.samples[index]!))
    view.setInt16(WAV_HEADER_BYTES + index * 2, Math.round(clamped * 32767), true)
  }
  return new Uint8Array(buffer)
}

/** Parse mono 16-bit PCM WAV bytes back to `PcmAudio`. Walks the RIFF
 *  chunks (providers may append LIST/fact chunks) instead of assuming the
 *  44-byte layout. Anything but mono 16-bit PCM throws — the providers are
 *  asked for exactly that shape, so a mismatch is a fault, not a case. */
export function decodeWavToPcm(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < WAV_HEADER_BYTES || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('decodeWavToPcm: not a RIFF/WAVE stream')
  }

  let sampleRate: number | null = null
  let offset = 12
  while (offset + RIFF_CHUNK_HEADER_BYTES <= bytes.byteLength) {
    const chunkId = readAscii(view, offset, 4)
    const chunkBytes = view.getUint32(offset + 4, true)
    const bodyOffset = offset + RIFF_CHUNK_HEADER_BYTES

    if (chunkId === 'fmt ') {
      const audioFormat = view.getUint16(bodyOffset, true)
      const channels = view.getUint16(bodyOffset + 2, true)
      const bitsPerSample = view.getUint16(bodyOffset + 14, true)
      if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
        throw new Error(
          `decodeWavToPcm: expected mono 16-bit PCM, got format ${audioFormat}, ` +
            `${channels} channel(s), ${bitsPerSample}-bit`,
        )
      }
      sampleRate = view.getUint32(bodyOffset + 4, true)
    }
    if (chunkId === 'data') {
      if (sampleRate === null) throw new Error('decodeWavToPcm: data chunk before fmt chunk')
      const clampedBytes = Math.min(chunkBytes, bytes.byteLength - bodyOffset)
      return {
        samples: int16BytesToFloat32(bytes.subarray(bodyOffset, bodyOffset + clampedBytes)),
        sampleRate,
      }
    }
    // Chunks are word-aligned: an odd-sized chunk carries one pad byte.
    offset = bodyOffset + chunkBytes + (chunkBytes % 2)
  }
  throw new Error('decodeWavToPcm: no data chunk found')
}

/** Raw 16-bit little-endian PCM bytes → Float32 samples in [-1, 1]. */
export function int16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768
  }
  return samples
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index))
  }
  return text
}
