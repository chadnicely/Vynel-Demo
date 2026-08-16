import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { cpal, type CpalStreamConfig } from './cpal.js'
import { openOutputSink } from './output-sink.js'

// Only the native binding is mocked (never-mock is about the DB). Timers AND
// performance.now run on the fake clock so drain math is exact.
vi.mock('./cpal.js', () => ({
  cpal: {
    createStream: vi.fn(() => 'handle-sink'),
    writeToStream: vi.fn(),
    closeStream: vi.fn(),
  },
}))

const createStream = vi.mocked(cpal.createStream)
const writeToStream = vi.mocked(cpal.writeToStream)
const closeStream = vi.mocked(cpal.closeStream)

function silentLogger() {
  return pino({ level: 'silent' })
}

const stereo32k: CpalStreamConfig = { sampleRate: 32_000, channels: 2 }

function openSink(onDrained = vi.fn()) {
  const sink = openOutputSink(
    silentLogger(),
    'speaker',
    { device: { deviceId: 'id:speakers', name: 'Speakers' }, config: stereo32k },
    onDrained,
  )
  return { sink, onDrained }
}

// One second of 16 kHz mono input audio.
function oneSecondOfSpeech() {
  return { samples: new Float32Array(16_000), sampleRate: 16_000 }
}

describe('openOutputSink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens an OUTPUT stream and writes PCM converted to the sink config', () => {
    const { sink } = openSink()
    expect(createStream).toHaveBeenCalledWith('id:speakers', false, stereo32k, expect.any(Function))

    // 2 mono samples at 16 kHz → 4 at 32 kHz → 8 interleaved stereo values.
    sink.emitAudio({ samples: new Float32Array([0.5, 0.5]), sampleRate: 16_000 })
    expect(writeToStream).toHaveBeenCalledTimes(1)
    const [handle, written] = writeToStream.mock.calls[0] as [unknown, Float32Array]
    expect(handle).toBe('handle-sink')
    expect(written).toHaveLength(8)
    expect(written[0]).toBeCloseTo(0.5, 5)
  })

  it('trickles keepalive silence while idle and pauses it while real audio flows', () => {
    const { sink } = openSink()

    // Faked performance.now() starts at 0 — matching lastRealEmitAt's initial
    // value — so the sink idles through the first 250 ms window. Step past it
    // before expecting the trickle.
    vi.advanceTimersByTime(300)
    expect(writeToStream).toHaveBeenCalled() // keepalive fired past the window
    const [, keepAliveFrame] = writeToStream.mock.calls[0] as [unknown, Float32Array]
    // 50 ms of silence in the sink's own format: 32000 * 2ch * 0.05 = 3200.
    expect(keepAliveFrame).toHaveLength(3200)
    expect(keepAliveFrame.every((sample) => sample === 0)).toBe(true)

    sink.emitAudio({ samples: new Float32Array([0.5]), sampleRate: 32_000 })
    writeToStream.mockClear()
    vi.advanceTimersByTime(200) // inside the 250 ms idle window — keepalive holds off
    expect(writeToStream).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200) // window passed — keepalive resumes
    expect(writeToStream).toHaveBeenCalled()
  })

  it('keepalive holds off while handed-over audio still drains inside the device', () => {
    const { sink } = openSink()

    // All writes are accepted instantly, so the queue reads empty — but the
    // DEVICE now holds a full second of audio. Silence trickled during that
    // second would land inside the sentence and split words.
    sink.emitAudio(oneSecondOfSpeech())
    writeToStream.mockClear()

    vi.advanceTimersByTime(950) // device still busy until t=1000
    expect(writeToStream).not.toHaveBeenCalled()

    vi.advanceTimersByTime(150) // drained — the trickle resumes
    expect(writeToStream).toHaveBeenCalled()
    const [, frame] = writeToStream.mock.calls[0] as [unknown, Float32Array]
    expect(frame.every((sample) => sample === 0)).toBe(true)
  })

  it('a keepalive refused with "buffer full" is swallowed, not thrown into the timer', () => {
    const { sink } = openSink()
    writeToStream.mockImplementation(() => {
      throw new Error('Failed to write to stream: buffer full')
    })

    // The stream is plainly not cold when it refuses silence — the tick must
    // survive and keep trying, not crash the interval.
    expect(() => vi.advanceTimersByTime(600)).not.toThrow()
    expect(writeToStream.mock.calls.length).toBeGreaterThan(1)
    sink.stop()
    // clearAllMocks does not clear implementations — drop the throw here so it
    // cannot leak into the next test's writes.
    writeToStream.mockReset()
  })

  it('a keepalive device fault is logged (throttled) — never silently swallowed', () => {
    const warn = vi.fn()
    const logger = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ReturnType<
      typeof silentLogger
    >
    const sink = openOutputSink(
      logger,
      'speaker',
      { device: { deviceId: 'id:speakers', name: 'Speakers' }, config: stereo32k },
      vi.fn(),
    )
    writeToStream.mockImplementation(() => {
      throw new Error('device disconnected')
    })

    vi.advanceTimersByTime(600) // several failing keepalive ticks past the idle window
    expect(warn).toHaveBeenCalledTimes(1) // logged once, then throttled
    vi.advanceTimersByTime(5_000) // throttle window passed — the fault logs again
    expect(warn.mock.calls.length).toBeGreaterThan(1)

    sink.stop()
    writeToStream.mockReset()
  })

  it('declares the sink drained only after queued audio + the playback tail', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.endSpeech() // immediately: 1000 ms queued − 0 played + 350 tail = 1350 ms

    vi.advanceTimersByTime(1349)
    expect(onDrained).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDrained).toHaveBeenCalledTimes(1)
  })

  it('re-arms the drain timer: a later endSpeech supersedes the earlier one', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.endSpeech()
    vi.advanceTimersByTime(500)
    sink.emitAudio(oneSecondOfSpeech()) // more speech queued mid-drain
    sink.endSpeech() // re-estimates: 2000 queued − 500 played + 350 = 1850 ms

    vi.advanceTimersByTime(1849)
    expect(onDrained).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDrained).toHaveBeenCalledTimes(1)
  })

  it('cutPlayback discards mid-drain audio, resolves the drain once, and re-arms nothing', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.endSpeech() // drain armed for t=1350
    vi.advanceTimersByTime(500)
    sink.cutPlayback()

    expect(closeStream).toHaveBeenCalledTimes(1)
    expect(createStream).toHaveBeenCalledTimes(2) // open + the discard-reopen
    expect(onDrained).toHaveBeenCalledTimes(1) // resolved NOW, not at t=1350
    vi.advanceTimersByTime(2000)
    expect(onDrained).toHaveBeenCalledTimes(1) // the old timer is gone
  })

  it('cutPlayback between sentences (no endSpeech yet) still resolves the waiter', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.cutPlayback()

    expect(onDrained).toHaveBeenCalledTimes(1)
  })

  it('cutPlayback on an idle sink reopens silently — no spurious drain signal', () => {
    const { sink, onDrained } = openSink()

    sink.cutPlayback()

    expect(createStream).toHaveBeenCalledTimes(2)
    // A spurious onDrained would leave a stale pending flag upstream and reopen
    // the mic into the NEXT speak's tail.
    expect(onDrained).not.toHaveBeenCalled()
  })

  it('the sink stays usable after a cut — later writes go to the fresh stream', () => {
    createStream.mockReturnValueOnce('handle-1').mockReturnValueOnce('handle-2')
    const { sink } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.cutPlayback()
    writeToStream.mockClear()
    sink.emitAudio(oneSecondOfSpeech())

    expect(writeToStream.mock.calls[0]?.[0]).toBe('handle-2')
  })

  it('a failed reopen degrades the sink to dead instead of crashing the keepalive', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.endSpeech()
    createStream.mockImplementationOnce(() => {
      throw new Error('device gone')
    })
    sink.cutPlayback()

    expect(onDrained).toHaveBeenCalledTimes(1) // the waiter still resolves
    writeToStream.mockClear()
    sink.emitAudio(oneSecondOfSpeech()) // swallowed — dead sink
    vi.advanceTimersByTime(500) // keepalive skips — no closed-handle hammering
    expect(writeToStream).not.toHaveBeenCalled()
    closeStream.mockClear()
    sink.stop() // clean no-op on the handle
    expect(closeStream).not.toHaveBeenCalled()
  })

  it('a close failure during cut is best-effort — the reopen still happens', () => {
    createStream.mockReturnValueOnce('handle-1').mockReturnValueOnce('handle-2')
    const { sink } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    closeStream.mockImplementationOnce(() => {
      throw new Error('handle already invalid')
    })
    sink.cutPlayback()

    writeToStream.mockClear()
    sink.emitAudio(oneSecondOfSpeech())
    expect(writeToStream.mock.calls[0]?.[0]).toBe('handle-2')
  })

  it('cutPlayback after stop is a no-op', () => {
    const { sink, onDrained } = openSink()

    sink.stop()
    sink.cutPlayback()

    expect(closeStream).toHaveBeenCalledTimes(1) // stop's close only
    expect(createStream).toHaveBeenCalledTimes(1) // no reopen
    expect(onDrained).not.toHaveBeenCalled()
  })

  it('stop closes the stream once, silences keepalive, and swallows late writes', () => {
    const { sink, onDrained } = openSink()

    sink.emitAudio(oneSecondOfSpeech())
    sink.endSpeech()
    sink.stop()
    sink.stop() // idempotent
    expect(closeStream).toHaveBeenCalledTimes(1)

    writeToStream.mockClear()
    sink.emitAudio(oneSecondOfSpeech()) // write-after-stop: swallowed, no throw
    vi.advanceTimersByTime(500) // keepalive cleared, pending drain cancelled
    expect(writeToStream).not.toHaveBeenCalled()
    expect(onDrained).not.toHaveBeenCalled()
  })

  // 1 s of 16 kHz mono becomes 32 kHz stereo: 64_000 interleaved samples.
  const INTERLEAVED_PER_SECOND = 64_000
  const delivered = () =>
    writeToStream.mock.calls.reduce((total, [, data]) => total + (data as Float32Array).length, 0)

  it('hands the device small chunks — never one oversized write', () => {
    const { sink } = openSink()

    sink.emitAudio(oneSecondOfSpeech())

    // The binding throws "buffer full" on an oversized write, which used to
    // abandon the rest of the line — every chunk must stay small.
    expect(writeToStream.mock.calls.length).toBeGreaterThan(1)
    for (const [, data] of writeToStream.mock.calls) {
      expect((data as Float32Array).length).toBeLessThanOrEqual(1024)
    }
    expect(delivered()).toBe(INTERLEAVED_PER_SECOND)
  })

  it('treats "buffer full" as backpressure — the refused chunk is retried, not lost', () => {
    const { sink } = openSink()
    let refusals = 0
    writeToStream.mockImplementation(() => {
      // Refuse every other write, as a device draining in real time would.
      if (refusals++ % 2 === 0) throw new Error('Failed to write to stream: buffer full')
    })

    sink.emitAudio(oneSecondOfSpeech())
    // Each tick makes partial progress; the queue survives the refusals.
    vi.advanceTimersByTime(200)

    const accepted = writeToStream.mock.calls.length - Math.ceil(refusals / 2)
    expect(accepted).toBeGreaterThan(0)
    expect(refusals).toBeGreaterThan(1) // the path was actually exercised
  })

  it('a real device fault drops the queue instead of spinning on a dead stream', () => {
    const { sink } = openSink()
    writeToStream.mockImplementation(() => {
      throw new Error('device disconnected')
    })

    sink.emitAudio(oneSecondOfSpeech())
    const afterFault = writeToStream.mock.calls.length
    vi.advanceTimersByTime(200)

    // Nothing is retried — a stream that will never accept audio is not worth
    // a queue that never empties.
    expect(writeToStream.mock.calls.length).toBe(afterFault)
  })

  it('cutPlayback discards audio that never reached the device', () => {
    const { sink } = openSink()
    writeToStream.mockImplementationOnce(() => {
      throw new Error('Failed to write to stream: buffer full')
    })

    sink.emitAudio(oneSecondOfSpeech()) // stalls immediately, all of it pending
    sink.cutPlayback()
    writeToStream.mockClear()
    vi.advanceTimersByTime(200)

    // Barge-in can now take back audio the device never received — before the
    // queue existed, every sample was already inside the binding.
    expect(delivered()).toBe(0)
  })
})
