import { beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal, type CpalStreamConfig } from './cpal.js'
import { CAPTURE_RATE, openCaptureStream } from './capture-stream.js'

// The native binding is the ONE thing mocked here (the never-mock rule is about
// the DB): createStream hands us back the registered callback so tests can push
// frames as the device would.
vi.mock('./cpal.js', () => ({
  cpal: {
    createStream: vi.fn(),
    closeStream: vi.fn(),
  },
}))

const createStream = vi.mocked(cpal.createStream)
const closeStream = vi.mocked(cpal.closeStream)

function silentLogger() {
  return pino({ level: 'silent' })
}

function fakeStream(handle: string) {
  let deliver: ((frame: Float32Array) => void) | undefined
  createStream.mockImplementationOnce((_deviceId, _isInput, _config, callback) => {
    deliver = callback
    return handle
  })
  return { push: (frame: Float32Array) => deliver?.(frame) }
}

const stereo32k: CpalStreamConfig = { sampleRate: 32_000, channels: 2 }

describe('openCaptureStream', () => {
  // Call counts on the module-level mocks accumulate across tests otherwise.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens an INPUT stream on the given device and converts frames to 16 kHz mono', () => {
    const device = fakeStream('handle-mic')
    const received: PcmAudio[] = []

    openCaptureStream(
      silentLogger(),
      'mic',
      { device: { deviceId: 'id:mic', name: 'Microphone' }, config: stereo32k },
      (audio) => received.push(audio),
    )

    expect(createStream).toHaveBeenCalledWith('id:mic', true, stereo32k, expect.any(Function))
    // Stereo interleaved [L,R,L,R] at 32 kHz: downmix averages pairs → [0.3, 0.3],
    // linear resample 32 kHz → 16 kHz halves the length → [0.3].
    device.push(new Float32Array([0.2, 0.4, 0.2, 0.4]))
    expect(received).toHaveLength(1)
    expect(received[0]?.sampleRate).toBe(CAPTURE_RATE)
    expect(received[0]?.samples).toHaveLength(1)
    expect(received[0]?.samples[0]).toBeCloseTo(0.3, 5)
  })

  it('runs two streams concurrently with independent consumers — no crosstalk', () => {
    const micDevice = fakeStream('handle-mic')
    const cableDevice = fakeStream('handle-cable')
    const micAudio: PcmAudio[] = []
    const cableAudio: PcmAudio[] = []
    const mono16k: CpalStreamConfig = { sampleRate: CAPTURE_RATE, channels: 1 }

    openCaptureStream(
      silentLogger(),
      'mic',
      { device: { deviceId: 'id:mic' }, config: mono16k },
      (audio) => micAudio.push(audio),
    )
    const cable = openCaptureStream(
      silentLogger(),
      'call:demo',
      { device: { deviceId: 'id:cable-b' }, config: mono16k },
      (audio) => cableAudio.push(audio),
    )

    micDevice.push(new Float32Array([0.5]))
    expect(micAudio).toHaveLength(1)
    expect(cableAudio).toHaveLength(0)

    cableDevice.push(new Float32Array([0.7]))
    expect(cableAudio).toHaveLength(1)
    expect(micAudio).toHaveLength(1)

    cable.stop()
    expect(closeStream).toHaveBeenCalledTimes(1)
    expect(closeStream).toHaveBeenCalledWith('handle-cable')
  })

  it('stop is idempotent — a second call never re-closes the native handle', () => {
    fakeStream('handle-once')
    const stream = openCaptureStream(
      silentLogger(),
      'call:demo',
      { device: { deviceId: 'id:cable-b' }, config: { sampleRate: CAPTURE_RATE, channels: 1 } },
      () => {},
    )

    stream.stop()
    stream.stop()
    expect(closeStream).toHaveBeenCalledTimes(1)
  })

  it('passes already-16 kHz mono frames through unchanged', () => {
    const device = fakeStream('handle-mic')
    const received: PcmAudio[] = []

    openCaptureStream(
      silentLogger(),
      'mic',
      { device: { deviceId: 'id:mic' }, config: { sampleRate: CAPTURE_RATE, channels: 1 } },
      (audio) => received.push(audio),
    )

    device.push(new Float32Array([0.1, -0.2, 0.3]))
    expect(received[0]?.samples).toEqual(new Float32Array([0.1, -0.2, 0.3]))
  })
})
