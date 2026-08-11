import { beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal } from './cpal.js'
import { openCaptureStream } from './capture-stream.js'
import { openOutputSink, type OutputSink } from './output-sink.js'
import { createAudioShell } from './audio-shell.js'

// The shell is pure composition now — both stream homes and the native
// binding are mocked; what's under test is the wiring and the start guard.
vi.mock('./cpal.js', () => ({
  cpal: {
    getDefaultInputDevice: vi.fn(() => ({ deviceId: 'id:default-mic', name: 'Default Mic' })),
    getDefaultOutputDevice: vi.fn(() => ({ deviceId: 'id:default-speaker', name: 'Default Speaker' })),
    getDefaultInputConfig: vi.fn(() => ({ sampleRate: 16_000, channels: 1 })),
    getDefaultOutputConfig: vi.fn(() => ({ sampleRate: 48_000, channels: 2 })),
  },
}))
vi.mock('./capture-stream.js', () => ({ openCaptureStream: vi.fn() }))
vi.mock('./output-sink.js', () => ({ openOutputSink: vi.fn() }))

const openCapture = vi.mocked(openCaptureStream)
const openSink = vi.mocked(openOutputSink)

function fakeSink(): OutputSink {
  return { emitAudio: vi.fn(), endSpeech: vi.fn(), stop: vi.fn() }
}

function silentLogger() {
  return pino({ level: 'silent' })
}

describe('createAudioShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openCapture.mockReturnValue({ stop: vi.fn() })
    openSink.mockReturnValue(fakeSink())
  })

  it('opens the speaker sink at construction and routes io to it', () => {
    const sink = fakeSink()
    openSink.mockReturnValue(sink)
    const onPlaybackDrained = vi.fn()

    const shell = createAudioShell(silentLogger(), onPlaybackDrained)
    const pcm: PcmAudio = { samples: new Float32Array([0.1]), sampleRate: 16_000 }
    shell.io.emitAudio(pcm)
    shell.io.endSpeech()

    // The drained callback must be THE driver's callback — the mic-reopen echo
    // defense rides on this wire.
    expect(openSink).toHaveBeenCalledWith(
      expect.anything(),
      'speaker',
      { device: { deviceId: 'id:default-speaker', name: 'Default Speaker' }, config: { sampleRate: 48_000, channels: 2 } },
      onPlaybackDrained,
    )
    expect(sink.emitAudio).toHaveBeenCalledWith(pcm)
    expect(sink.endSpeech).toHaveBeenCalledTimes(1)
  })

  it('start opens the primary mic once — a duplicate start is ignored, loudly', () => {
    const logger = silentLogger()
    const warn = vi.spyOn(logger, 'warn')
    const shell = createAudioShell(logger, () => {})

    shell.start(() => {})
    shell.start(() => {})

    expect(openCapture).toHaveBeenCalledTimes(1)
    expect(openCapture).toHaveBeenCalledWith(
      expect.anything(),
      'mic',
      { device: { deviceId: 'id:default-mic', name: 'Default Mic' }, config: { sampleRate: 16_000, channels: 1 } },
      expect.any(Function),
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('passes an explicitly selected device pair through to both stream homes', () => {
    const input = { deviceId: 'id:cable-b', name: 'CABLE Output (VB-Audio Cable B)' }
    const output = { deviceId: 'id:cable-a', name: 'CABLE Input (VB-Audio Virtual Cable)' }

    const shell = createAudioShell(silentLogger(), () => {}, { input, output })
    shell.start(() => {})

    expect(openSink.mock.calls[0]?.[2]?.device).toBe(output)
    expect(openCapture.mock.calls[0]?.[2]?.device).toBe(input)
  })

  it('stop stops whichever streams exist — sink always, capture only if started', () => {
    const sink = fakeSink()
    openSink.mockReturnValue(sink)
    const captureStop = vi.fn()
    openCapture.mockReturnValue({ stop: captureStop })

    const neverStarted = createAudioShell(silentLogger(), () => {})
    neverStarted.stop()
    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(captureStop).not.toHaveBeenCalled()

    const started = createAudioShell(silentLogger(), () => {})
    started.start(() => {})
    started.stop()
    expect(captureStop).toHaveBeenCalledTimes(1)
  })
})
