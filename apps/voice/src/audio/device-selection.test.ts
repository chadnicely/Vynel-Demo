import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { CpalEnumeratedDevice, CpalStreamConfig } from './cpal.js'
import {
  isVynelVirtualDevice,
  resolveAudioDevices,
  selectDeviceConfig,
} from './device-selection.js'

// Shapes mirror the live 2026-08-11 probe of node-cpal v0.1.1 on WASAPI
// (deviceId === name there; kept distinct here to prove we return the id field).
function enumeratedDevice(overrides: Partial<CpalEnumeratedDevice>): CpalEnumeratedDevice {
  return {
    name: 'Speakers (USBFC1 WENC)',
    deviceId: 'id:speakers',
    hostId: 'WASAPI',
    isDefaultInput: false,
    isDefaultOutput: false,
    ...overrides,
  }
}

const cableOutput = enumeratedDevice({
  name: 'CABLE Output (VB-Audio Virtual Cable)',
  deviceId: 'id:cable-output',
  isDefaultInput: false,
})
const microphone = enumeratedDevice({
  name: 'Microphone (USBFC1 WENC)',
  deviceId: 'id:microphone',
  isDefaultInput: true,
})
const speakers = enumeratedDevice({ isDefaultOutput: true })
const allDevices = [speakers, cableOutput, microphone]

function fakeLogger() {
  const logger = pino({ level: 'silent' })
  return { logger, error: vi.spyOn(logger, 'error') }
}

describe('resolveAudioDevices', () => {
  it('skips enumeration entirely when no device is requested (default behavior untouched)', () => {
    const { logger, error } = fakeLogger()
    const listDevices = vi.fn(() => allDevices)

    expect(resolveAudioDevices(logger, {}, listDevices)).toEqual({})
    expect(listDevices).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('resolves requested input and output names to their devices', () => {
    const { logger, error } = fakeLogger()

    const selection = resolveAudioDevices(
      logger,
      { inputName: 'Microphone (USBFC1 WENC)', outputName: 'Speakers (USBFC1 WENC)' },
      () => allDevices,
    )

    expect(selection.input).toBe(microphone)
    expect(selection.output).toBe(speakers)
    expect(error).not.toHaveBeenCalled()
  })

  it('falls back (leaves the direction unset) and logs actionably when a name is missing', () => {
    const { logger, error } = fakeLogger()

    const selection = resolveAudioDevices(
      logger,
      { inputName: 'CABLE Output (VB-Audio Cable B)' },
      () => allDevices,
    )

    expect(selection).toEqual({})
    expect(error).toHaveBeenCalledTimes(1)
    const [context] = error.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(context['requestedName']).toBe('CABLE Output (VB-Audio Cable B)')
    expect(context['direction']).toBe('input')
    expect(context['availableDevices']).toEqual(allDevices.map((device) => device.name))
  })

  it('resolves one direction while the other falls back, each judged independently', () => {
    const { logger, error } = fakeLogger()

    const selection = resolveAudioDevices(
      logger,
      { inputName: 'Microphone (USBFC1 WENC)', outputName: 'CABLE Input (VB-Audio Virtual Cable)' },
      () => allDevices,
    )

    expect(selection.input).toBe(microphone)
    expect(selection.output).toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('selectDeviceConfig', () => {
  const workingConfig: CpalStreamConfig = { sampleRate: 48_000, channels: 2 }

  it('uses the selected device and its own config when the direction works', () => {
    const { logger, error } = fakeLogger()
    const getDefaultDevice = vi.fn(() => microphone)

    const selected = selectDeviceConfig(logger, 'input', cableOutput, getDefaultDevice, () => workingConfig)

    expect(selected.device).toBe(cableOutput)
    expect(selected.config).toBe(workingConfig)
    expect(getDefaultDevice).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('opens the system default when nothing was selected, silently', () => {
    const { logger, error } = fakeLogger()

    const selected = selectDeviceConfig(logger, 'input', undefined, () => microphone, () => workingConfig)

    expect(selected.device).toBe(microphone)
    expect(error).not.toHaveBeenCalled()
  })

  // Windows made the call driver's capture endpoint the default recording device
  // (2026-08-19: the daemon booted deaf on "Vynel Call 1 Microphone (Vynel Audio)").
  it("never listens to Vynel's own virtual call microphone by default — takes the first real input, loudly", () => {
    const { logger } = fakeLogger()
    const warn = vi.spyOn(logger, 'warn')
    const virtualMic = enumeratedDevice({
      name: 'Vynel Call 1 Microphone (Vynel Audio)',
      deviceId: 'id:vynel-call-1-mic',
      isDefaultInput: true,
    })
    const virtualSpeaker = enumeratedDevice({
      name: 'Vynel Call 1 Speaker (Vynel Audio)',
      deviceId: 'id:vynel-call-1-spk',
    })
    const getConfig = vi.fn((deviceId: string) => {
      if (deviceId === 'id:speakers') throw new Error('not an input')
      return workingConfig
    })
    const selected = selectDeviceConfig(
      logger,
      'input',
      undefined,
      () => virtualMic,
      getConfig,
      () => [virtualMic, virtualSpeaker, speakers, microphone],
    )
    expect(selected.device).toBe(microphone)
    expect(warn).toHaveBeenCalledWith(
      { defaultDevice: virtualMic.name, chosenDevice: microphone.name },
      expect.stringContaining('virtual call microphone'),
    )
  })

  it('stays on the virtual default (said loudly) when no other device can record', () => {
    const { logger, error } = fakeLogger()
    const virtualMic = enumeratedDevice({ name: 'Vynel Call 2 Microphone (Vynel Audio)', deviceId: 'id:v2' })
    const selected = selectDeviceConfig(
      logger,
      'input',
      undefined,
      () => virtualMic,
      (deviceId) => {
        if (deviceId === 'id:v2') return workingConfig
        throw new Error('not an input')
      },
      () => [virtualMic, speakers],
    )
    expect(selected.device).toBe(virtualMic)
    expect(error).toHaveBeenCalledWith(
      { defaultDevice: virtualMic.name },
      expect.stringContaining('wake word will not be heard'),
    )
  })

  it('an explicitly configured Vynel virtual input is honored (the guard is default-only)', () => {
    const { logger } = fakeLogger()
    const virtualMic = enumeratedDevice({ name: 'Vynel Call 1 Microphone (Vynel Audio)', deviceId: 'id:v1' })
    const selected = selectDeviceConfig(logger, 'input', virtualMic, () => microphone, () => workingConfig, () => allDevices)
    expect(selected.device).toBe(virtualMic)
  })

  it("recognizes the call driver's endpoints and nothing else", () => {
    expect(isVynelVirtualDevice('Vynel Call 1 Microphone (Vynel Audio)')).toBe(true)
    expect(isVynelVirtualDevice('vynel call 12 speaker (vynel audio)')).toBe(true)
    expect(isVynelVirtualDevice('Microphone (USBFC1 WENC)')).toBe(false)
    expect(isVynelVirtualDevice('CABLE Output (VB-Audio Virtual Cable)')).toBe(false)
  })

  it('falls back to the default, loudly, when the selected device rejects the direction', () => {
    const { logger, error } = fakeLogger()
    // The real failure shape (probed live): VB-Cable's playback end named as the
    // input device — the config call throws "stream type is not supported".
    const wrongEnd = enumeratedDevice({
      name: 'CABLE Input (VB-Audio Virtual Cable)',
      deviceId: 'id:cable-input',
    })
    const getConfig = vi.fn((deviceId: string): CpalStreamConfig => {
      if (deviceId === wrongEnd.deviceId)
        throw new Error('Failed to get default config: The requested stream type is not supported by the device.')
      return workingConfig
    })

    const selected = selectDeviceConfig(logger, 'input', wrongEnd, () => microphone, getConfig)

    expect(selected.device).toBe(microphone)
    expect(selected.config).toBe(workingConfig)
    expect(error).toHaveBeenCalledTimes(1)
    const [context] = error.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(context['device']).toBe('CABLE Input (VB-Audio Virtual Cable)')
    expect(context['direction']).toBe('input')
  })

  it('lets a broken DEFAULT device propagate — the fail-fast boot behavior is unchanged', () => {
    const { logger } = fakeLogger()
    const getConfig = (): CpalStreamConfig => {
      throw new Error('no audio devices at all')
    }

    expect(() => selectDeviceConfig(logger, 'output', undefined, () => speakers, getConfig)).toThrow(
      'no audio devices at all',
    )
  })
})
