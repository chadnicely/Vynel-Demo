import { describe, expect, it } from 'vitest'
import { SpeechSegmenter } from './audio-segmenter.js'

const SAMPLE_RATE = 16000

function ms(durationMs: number): number {
  return Math.round((SAMPLE_RATE * durationMs) / 1000)
}

/** Silence (zeros). */
function silence(durationMs: number): Float32Array {
  return new Float32Array(ms(durationMs))
}

/** "Speech" — constant amplitude well above the energy threshold. */
function speech(durationMs: number, amplitude = 0.1): Float32Array {
  return new Float32Array(ms(durationMs)).fill(amplitude)
}

function concatAll(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Feed audio in small chunks (exercises the partial-frame buffering). */
function feed(segmenter: SpeechSegmenter, audio: Float32Array, chunk = 1024): Float32Array[] {
  const out: Float32Array[] = []
  for (let i = 0; i < audio.length; i += chunk) {
    out.push(...segmenter.push(audio.subarray(i, i + chunk)))
  }
  const tail = segmenter.flush()
  if (tail !== null) out.push(tail)
  return out
}

describe('SpeechSegmenter', () => {
  it('emits one segment for speech bounded by silence', () => {
    const segmenter = new SpeechSegmenter()
    const segments = feed(segmenter, concatAll([silence(500), speech(1000), silence(1000)]))
    expect(segments).toHaveLength(1)
    // The segment is the speech (~1000 ms) plus pre-roll, minus the trailing
    // silence-run that triggered the close — comfortably within a loose window.
    expect(segments[0]!.length).toBeGreaterThan(ms(800))
    expect(segments[0]!.length).toBeLessThan(ms(1600))
  })

  it('drops a blip shorter than minSpeechMs', () => {
    const segmenter = new SpeechSegmenter()
    const segments = feed(segmenter, concatAll([silence(500), speech(100), silence(1000)]))
    expect(segments).toHaveLength(0)
  })

  it('separates two utterances split by a silence gap', () => {
    const segmenter = new SpeechSegmenter()
    const segments = feed(
      segmenter,
      concatAll([silence(300), speech(800), silence(900), speech(800), silence(900)]),
    )
    expect(segments).toHaveLength(2)
  })

  it('flush() closes a segment still open at end of stream', () => {
    const segmenter = new SpeechSegmenter()
    // No trailing silence — only flush can close it.
    const segments = feed(segmenter, concatAll([silence(300), speech(1000)]))
    expect(segments).toHaveLength(1)
  })

  it('force-closes a runaway segment at maxSegmentMs', () => {
    const segmenter = new SpeechSegmenter({ maxSegmentMs: 1000 })
    const segments = feed(segmenter, speech(3000))
    // A 3 s burst with a 1 s cap yields multiple forced segments, never one giant one.
    expect(segments.length).toBeGreaterThanOrEqual(2)
  })
})
