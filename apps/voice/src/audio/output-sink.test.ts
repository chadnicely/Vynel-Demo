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
})
