import type { PcmAudio } from '@vynel/voice-engine'

// Encode engine PCM (Float32, mono) as a 16-bit WAV byte buffer — the wire
// format the overlay channel's /synthesize returns so the browser can play a
// Kokoro reply with a plain <audio> element.

const WAV_HEADER_BYTES = 44

export function encodeWav(pcm: PcmAudio): Uint8Array {
  const sampleCount = pcm.samples.length
  const dataBytes = sampleCount * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, pcm.sampleRate, true)
  view.setUint32(28, pcm.sampleRate * 2, true) // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < sampleCount; i += 1) {
    const clamped = Math.max(-1, Math.min(1, pcm.samples[i]!))
    view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(clamped * 32767), true)
  }
  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}
