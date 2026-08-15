import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import type { ProcessLoopbackAddon, ProcessLoopbackHandle } from './process-loopback.js'
import { openProcessLoopbackCapture } from './process-loopback-capture.js'
import { CAPTURE_RATE } from './capture-stream.js'

const logger = pino({ level: 'silent' })

// A fake native addon: hands the registered onAudio callback back to the test
// so it can inject frames, and records start/stop like the real binding.
function fakeAddon(overrides?: Partial<ProcessLoopbackAddon>) {
  const handle: ProcessLoopbackHandle = { id: 'native-1' }
  let deliver: ((frame: Float32Array) => void) | undefined
  const start = vi.fn(
    (_pid: number, _tree: boolean, onFrame: (frame: Float32Array) => void): ProcessLoopbackHandle => {
      deliver = onFrame
      return handle
    },
  )
  const stop = vi.fn()
  const addon: ProcessLoopbackAddon = {
    start,
    stop,
    captureSampleRate: 48_000,
    captureChannels: 2,
    ...overrides,
  }
  return { addon, start, stop, handle, frame: (samples: Float32Array) => deliver?.(samples) }
}

describe('openProcessLoopbackCapture', () => {
  it('starts capture on the pid with the process tree by default', () => {
    const { addon, start } = fakeAddon()
    openProcessLoopbackCapture(logger, 'call:1', { processId: 4321 }, vi.fn(), addon)
    expect(start).toHaveBeenCalledWith(4321, true, expect.any(Function))
  })

  it('passes includeProcessTree=false straight through', () => {
    const { addon, start } = fakeAddon()
    openProcessLoopbackCapture(
      logger,
      'call:1',
      { processId: 7, includeProcessTree: false },
      vi.fn(),
      addon,
    )
    expect(start).toHaveBeenCalledWith(7, false, expect.any(Function))
  })

  it('downmixes stereo to mono and resamples to 16 kHz', () => {
    const { addon, frame } = fakeAddon()
    const received: PcmAudio[] = []
    openProcessLoopbackCapture(logger, 'call:1', { processId: 1 }, (audio) => received.push(audio), addon)

    // Two stereo frames [L,R,L,R] → mono averages [0.5, 0.5] at 48 kHz →
    // resampled toward 16 kHz (one-third the length).
    frame(new Float32Array([1, 0, 1, 0]))

    expect(received).toHaveLength(1)
    expect(received[0]!.sampleRate).toBe(CAPTURE_RATE)
    expect(received[0]!.samples.length).toBeGreaterThan(0)
    for (const sample of received[0]!.samples) expect(sample).toBeCloseTo(0.5, 5)
  })

  it('stop() releases the native handle exactly once, even when called twice', () => {
    const { addon, stop, handle } = fakeAddon()
    const stream = openProcessLoopbackCapture(logger, 'call:1', { processId: 1 }, vi.fn(), addon)

    stream.stop()
    stream.stop()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(handle)
  })

  it('marks silent buffers by delivering zeros, not by dropping', () => {
    const { addon, frame } = fakeAddon()
    const received: PcmAudio[] = []
    openProcessLoopbackCapture(logger, 'call:1', { processId: 1 }, (audio) => received.push(audio), addon)

    frame(new Float32Array([0, 0, 0, 0]))

    expect(received).toHaveLength(1)
    for (const sample of received[0]!.samples) expect(sample).toBe(0)
  })

  it('throws an actionable error when the addon is unavailable', () => {
    expect(() =>
      openProcessLoopbackCapture(logger, 'call:1', { processId: 1 }, vi.fn(), null),
    ).toThrow(/process-loopback capture is unavailable/)
  })
})
