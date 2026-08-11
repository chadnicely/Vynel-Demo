import { beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal } from '../audio/cpal.js'
import { openCaptureStream } from '../audio/capture-stream.js'
import { openOutputSink, type OutputSink } from '../audio/output-sink.js'
import {
  CallRegistry,
  CallRegistryError,
  type CallCableNames,
  type CallRegistryErrorKind,
} from './call-registry.js'

vi.mock('../audio/cpal.js', () => ({
  cpal: {
    getDevices: vi.fn(),
    getDefaultInputConfig: vi.fn(),
    getDefaultOutputConfig: vi.fn(),
  },
}))
vi.mock('../audio/capture-stream.js', () => ({ openCaptureStream: vi.fn() }))
vi.mock('../audio/output-sink.js', () => ({ openOutputSink: vi.fn() }))

const getDevices = vi.mocked(cpal.getDevices)
const getDefaultInputConfig = vi.mocked(cpal.getDefaultInputConfig)
const getDefaultOutputConfig = vi.mocked(cpal.getDefaultOutputConfig)
const openCapture = vi.mocked(openCaptureStream)
const openSink = vi.mocked(openOutputSink)

const cableBOut = {
  name: 'CABLE-B Output (VB-Audio Cable B)',
  deviceId: 'id:cable-b-out',
  hostId: 'WASAPI',
  isDefaultInput: false,
  isDefaultOutput: false,
}
const cableAIn = {
  name: 'CABLE Input (VB-Audio Virtual Cable)',
  deviceId: 'id:cable-a-in',
  hostId: 'WASAPI',
  isDefaultInput: false,
  isDefaultOutput: false,
}
const CABLES = { inputName: cableBOut.name, outputName: cableAIn.name }

function fakeSink(): OutputSink {
  return { emitAudio: vi.fn(), endSpeech: vi.fn(), cutPlayback: vi.fn(), stop: vi.fn() }
}

function registryWith(cables: CallCableNames = CABLES) {
  return new CallRegistry(pino({ level: 'silent' }), cables)
}

function expectRegistryError(run: () => unknown, kind: CallRegistryErrorKind, messagePart: string) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CallRegistryError)
    expect((error as CallRegistryError).kind).toBe(kind)
    expect((error as CallRegistryError).message).toContain(messagePart)
    return
  }
  expect.fail(`expected a CallRegistryError(${kind})`)
}

describe('CallRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDevices.mockReturnValue([cableBOut, cableAIn])
    getDefaultInputConfig.mockReturnValue({ sampleRate: 16_000, channels: 1 })
    getDefaultOutputConfig.mockReturnValue({ sampleRate: 48_000, channels: 2 })
    openCapture.mockReturnValue({ stop: vi.fn() })
    openSink.mockReturnValue(fakeSink())
  })

  it('refuses to start without configured cables, naming the env vars', () => {
    expectRegistryError(
      () => registryWith({}).startCall({ label: 'standup', mode: 'notetaker' }),
      'not-configured',
      'VYNEL_CALL_INPUT_DEVICE',
    )
  })

  it('refuses a cable name that is not installed, listing what IS available', () => {
    const registry = registryWith({ inputName: 'BlackHole 2ch', outputName: cableAIn.name })
    expectRegistryError(
      () => registry.startCall({ label: 'standup', mode: 'notetaker' }),
      'device-missing',
      cableBOut.name, // the available-devices list names the real cables
    )
  })

  it('refuses a wrong-direction cable end instead of falling back to a real device', () => {
    getDefaultInputConfig.mockImplementation(() => {
      throw new Error('The requested stream type is not supported by the device.')
    })
    expectRegistryError(
      () => registryWith().startCall({ label: 'standup', mode: 'notetaker' }),
      'device-missing',
      "can't record",
    )
  })

  it('opens the pair strictly on the configured cables, labeled by call id', () => {
    const registry = registryWith()
    const descriptor = registry.startCall({ label: '9pm standup', mode: 'participant' })

    expect(descriptor.label).toBe('9pm standup')
    expect(descriptor.mode).toBe('participant')
    expect(Date.parse(descriptor.startedAtIso)).not.toBeNaN()
    expect(getDefaultInputConfig).toHaveBeenCalledWith('id:cable-b-out')
    expect(getDefaultOutputConfig).toHaveBeenCalledWith('id:cable-a-in')
    expect(openCapture).toHaveBeenCalledWith(
      expect.anything(),
      `call:${descriptor.callId}`,
      { device: cableBOut, config: { sampleRate: 16_000, channels: 1 } },
      expect.any(Function),
    )
    expect(openSink).toHaveBeenCalledWith(
      expect.anything(),
      `call:${descriptor.callId}`,
      { device: cableAIn, config: { sampleRate: 48_000, channels: 2 } },
      expect.any(Function),
    )
  })

  it('delivers call audio to the bound loop — and silently discards when unbound', () => {
    let deliver: ((audio: PcmAudio) => void) | undefined
    openCapture.mockImplementation((_logger, _label, _source, onAudio) => {
      deliver = onAudio
      return { stop: vi.fn() }
    })
    const registry = registryWith()
    const { callId } = registry.startCall({ label: 'standup', mode: 'notetaker' })
    const pcm: PcmAudio = { samples: new Float32Array([0.1]), sampleRate: 16_000 }

    deliver?.(pcm) // unbound: must not throw
    const onCallAudio = vi.fn()
    registry.bindCallLoop({ onCallAudio, onCallDrained: vi.fn() })
    deliver?.(pcm)

    expect(onCallAudio).toHaveBeenCalledTimes(1)
    expect(onCallAudio).toHaveBeenCalledWith(callId, pcm)
  })

  it('routes a call sink drain to the bound loop with the call id', () => {
    let fireDrained: (() => void) | undefined
    openSink.mockImplementation((_logger, _label, _source, onDrained) => {
      fireDrained = onDrained
      return fakeSink()
    })
    const registry = registryWith()
    const { callId } = registry.startCall({ label: 'standup', mode: 'notetaker' })

    fireDrained?.() // unbound: must not throw
    const onCallDrained = vi.fn()
    registry.bindCallLoop({ onCallAudio: vi.fn(), onCallDrained })
    fireDrained?.()

    expect(onCallDrained).toHaveBeenCalledTimes(1)
    expect(onCallDrained).toHaveBeenCalledWith(callId)
  })

  it('a capture that fails to open stops the already-live sink — no orphan leak', () => {
    const sink = fakeSink()
    openSink.mockReturnValue(sink)
    openCapture.mockImplementation(() => {
      throw new Error('stream claim rejected')
    })
    const registry = registryWith()

    expectRegistryError(
      () => registry.startCall({ label: 'standup', mode: 'notetaker' }),
      'device-missing',
      'failed to open',
    )
    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(registry.listCalls()).toEqual([])
  })

  it('refuses a second call while the cable pair is in use, naming the holder', () => {
    const registry = registryWith()
    const first = registry.startCall({ label: 'standup', mode: 'notetaker' })
    expectRegistryError(
      () => registry.startCall({ label: '1:1', mode: 'participant' }),
      'pair-busy',
      first.callId,
    )
  })

  it('endCall stops both streams and forgets the call', () => {
    const sink = fakeSink()
    const captureStop = vi.fn()
    openSink.mockReturnValue(sink)
    openCapture.mockReturnValue({ stop: captureStop })
    const registry = registryWith()
    const { callId } = registry.startCall({ label: 'standup', mode: 'notetaker' })

    registry.endCall(callId)

    expect(captureStop).toHaveBeenCalledTimes(1)
    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(registry.listCalls()).toEqual([])
    expectRegistryError(() => registry.endCall(callId), 'unknown-call', callId)
  })

  it('findCallSink serves the live sink and null after the call ends', () => {
    const sink = fakeSink()
    openSink.mockReturnValue(sink)
    const registry = registryWith()
    const { callId } = registry.startCall({ label: 'standup', mode: 'notetaker' })

    expect(registry.findCallSink(callId)).toBe(sink)
    registry.endCall(callId)
    expect(registry.findCallSink(callId)).toBeNull()
  })

  it('stopAll ends every live call (shutdown path)', () => {
    const sink = fakeSink()
    openSink.mockReturnValue(sink)
    const registry = registryWith()
    registry.startCall({ label: 'standup', mode: 'notetaker' })

    registry.stopAll()

    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(registry.listCalls()).toEqual([])
  })
})
