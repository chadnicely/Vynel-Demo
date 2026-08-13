import { beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal } from '../audio/cpal.js'
import { openCaptureStream } from '../audio/capture-stream.js'
import { openOutputSink, type OutputSink } from '../audio/output-sink.js'
import {
  CallRegistry,
  CallRegistryError,
  type CallCablePair,
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
const PAIR_ONE: CallCablePair = { inputName: cableBOut.name, outputName: cableAIn.name }

function fakeSink(): OutputSink {
  return { emitAudio: vi.fn(), endSpeech: vi.fn(), cutPlayback: vi.fn(), stop: vi.fn() }
}

function registryWith(pairs: readonly CallCablePair[] = [PAIR_ONE]) {
  return new CallRegistry(pino({ level: 'silent' }), pairs)
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
      () => registryWith([]).startCall({ label: 'standup', mode: 'notetaker' }),
      'not-configured',
      'VYNEL_CALL_INPUT_DEVICE',
    )
  })

  it('refuses a cable name that is not installed, listing what IS available', () => {
    const registry = registryWith([{ inputName: 'BlackHole 2ch', outputName: cableAIn.name }])
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
    registry.bindCallLoop({
      onCallStarted: vi.fn(),
      onCallAudio,
      onCallDrained: vi.fn(),
      onCallEnded: vi.fn(),
    })
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
    registry.bindCallLoop({
      onCallStarted: vi.fn(),
      onCallAudio: vi.fn(),
      onCallDrained,
      onCallEnded: vi.fn(),
    })
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

  it('a second installed pair carries a second concurrent call — and frees on end', () => {
    const cableDOut = {
      name: 'CABLE-D Output (VB-Audio Cable D)',
      deviceId: 'id:cable-d-out',
      hostId: 'WASAPI',
      isDefaultInput: false,
      isDefaultOutput: false,
    }
    const cableCIn = {
      name: 'CABLE-C Input (VB-Audio Cable C)',
      deviceId: 'id:cable-c-in',
      hostId: 'WASAPI',
      isDefaultInput: false,
      isDefaultOutput: false,
    }
    getDevices.mockReturnValue([cableBOut, cableAIn, cableDOut, cableCIn])
    const pairTwo: CallCablePair = { inputName: cableDOut.name, outputName: cableCIn.name }
    const registry = registryWith([PAIR_ONE, pairTwo])

    const first = registry.startCall({ label: 'standup', mode: 'notetaker' })
    const second = registry.startCall({ label: '1:1', mode: 'participant' })
    expect(registry.listCalls()).toHaveLength(2)
    // The second call resolved the SECOND pair's cables.
    expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:cable-d-out')

    expectRegistryError(
      () => registry.startCall({ label: 'third', mode: 'notetaker' }),
      'pair-busy',
      'all 2 cable pair(s)',
    )

    registry.endCall(first.callId) // pair one frees
    const third = registry.startCall({ label: 'retro', mode: 'notetaker' })
    expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:cable-b-out')
    expect(registry.listCalls().map((call) => call.callId)).toEqual([second.callId, third.callId])
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

  it('announces lifecycle to the bound loop — started with the full descriptor, ended by id', () => {
    const onCallStarted = vi.fn()
    const onCallEnded = vi.fn()
    const registry = registryWith()
    registry.bindCallLoop({
      onCallStarted,
      onCallAudio: vi.fn(),
      onCallDrained: vi.fn(),
      onCallEnded,
    })

    const descriptor = registry.startCall({ label: 'standup', mode: 'notetaker', sessionId: 'sess-1' })

    expect(onCallStarted).toHaveBeenCalledWith(descriptor)
    expect(descriptor.sessionId).toBe('sess-1')

    registry.endCall(descriptor.callId)
    expect(onCallEnded).toHaveBeenCalledWith(descriptor.callId)
  })

  it('endCall stops the conversation BEFORE the streams — a drain wait must resolve through the live cut', () => {
    const order: string[] = []
    const sink = fakeSink()
    vi.mocked(sink.stop).mockImplementation(() => order.push('sink'))
    openSink.mockReturnValue(sink)
    openCapture.mockReturnValue({ stop: vi.fn(() => void order.push('capture')) })
    const registry = registryWith()
    registry.bindCallLoop({
      onCallStarted: vi.fn(),
      onCallAudio: vi.fn(),
      onCallDrained: vi.fn(),
      onCallEnded: vi.fn(() => order.push('conversation')),
    })

    const { callId } = registry.startCall({ label: 'standup', mode: 'notetaker' })
    registry.endCall(callId)

    expect(order).toEqual(['conversation', 'capture', 'sink'])
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

  describe('auto-discovered Vynel Call pairs', () => {
    const vynelEars = {
      name: 'Vynel Call 1 Ears (Vynel Virtual Audio)',
      deviceId: 'id:vynel-1-ears',
      hostId: 'WASAPI',
      isDefaultInput: false,
      isDefaultOutput: false,
    }
    const vynelVoice = {
      name: 'Vynel Call 1 Voice (Vynel Virtual Audio)',
      deviceId: 'id:vynel-1-voice',
      hostId: 'WASAPI',
      isDefaultInput: false,
      isDefaultOutput: false,
    }

    it('claims a discovered pair with zero env config', () => {
      getDevices.mockReturnValue([vynelEars, vynelVoice])
      const registry = registryWith([])

      const descriptor = registry.startCall({ label: 'standup', mode: 'notetaker' })

      expect(descriptor.label).toBe('standup')
      expect(getDefaultInputConfig).toHaveBeenCalledWith('id:vynel-1-ears')
      expect(getDefaultOutputConfig).toHaveBeenCalledWith('id:vynel-1-voice')
    })

    it('prefers the discovered pair over the env inventory — env stays the fallback', () => {
      getDevices.mockReturnValue([cableBOut, cableAIn, vynelEars, vynelVoice])
      const registry = registryWith([PAIR_ONE])

      registry.startCall({ label: 'first', mode: 'notetaker' })
      expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:vynel-1-ears')

      registry.startCall({ label: 'second', mode: 'participant' })
      expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:cable-b-out')
      expect(registry.listCalls()).toHaveLength(2)
    })

    it('an env pair duplicating a discovered pair does not double capacity', () => {
      getDevices.mockReturnValue([vynelEars, vynelVoice])
      const registry = registryWith([{ inputName: vynelEars.name, outputName: vynelVoice.name }])

      registry.startCall({ label: 'first', mode: 'notetaker' })
      expectRegistryError(
        () => registry.startCall({ label: 'second', mode: 'participant' }),
        'pair-busy',
        'all 1 cable pair(s)',
      )
    })

    it('devices installed between starts are claimed without a restart', () => {
      getDevices.mockReturnValueOnce([cableBOut, cableAIn])
      const registry = registryWith([PAIR_ONE])
      registry.startCall({ label: 'first', mode: 'notetaker' })

      getDevices.mockReturnValue([cableBOut, cableAIn, vynelEars, vynelVoice])
      registry.startCall({ label: 'second', mode: 'participant' })

      expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:vynel-1-ears')
      expect(registry.listCalls()).toHaveLength(2)
    })

    it('a lone orphan end is not an inventory — still not-configured', () => {
      getDevices.mockReturnValue([vynelEars])
      expectRegistryError(
        () => registryWith([]).startCall({ label: 'standup', mode: 'notetaker' }),
        'not-configured',
        'VYNEL_CALL_INPUT_DEVICE',
      )
    })

    it('a pair reusing an end of an earlier pair is skipped — one call per physical end', () => {
      getDevices.mockReturnValue([vynelEars, vynelVoice, cableAIn])
      const registry = registryWith([{ inputName: vynelEars.name, outputName: cableAIn.name }])

      registry.startCall({ label: 'first', mode: 'notetaker' })
      expectRegistryError(
        () => registry.startCall({ label: 'second', mode: 'participant' }),
        'pair-busy',
        'all 1 cable pair(s)',
      )
    })

    it('a held pair vanishing between starts blocks nothing and cannot be double-claimed', () => {
      const vynelEars2 = { ...vynelEars, name: 'Vynel Call 2 Ears', deviceId: 'id:vynel-2-ears' }
      const vynelVoice2 = { ...vynelVoice, name: 'Vynel Call 2 Voice', deviceId: 'id:vynel-2-voice' }
      getDevices.mockReturnValueOnce([vynelEars, vynelVoice])
      const registry = registryWith([])
      registry.startCall({ label: 'first', mode: 'notetaker' })

      getDevices.mockReturnValue([vynelEars2, vynelVoice2])
      registry.startCall({ label: 'second', mode: 'participant' })

      expect(registry.listCalls()).toHaveLength(2)
      expect(getDefaultInputConfig).toHaveBeenLastCalledWith('id:vynel-2-ears')
      expectRegistryError(
        () => registry.startCall({ label: 'third', mode: 'notetaker' }),
        'pair-busy',
        'all 1 cable pair(s)',
      )
    })
  })
})
