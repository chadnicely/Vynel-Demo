import type { Logger } from 'pino'
import type { CpalDevice, CpalEnumeratedDevice, CpalStreamConfig } from './cpal.js'

// Resolves the user's configured device NAMES (env) to concrete cpal devices.
// Pure on purpose: it takes the enumerated list as an input and never imports
// the native binding, so the fallback rules stay unit-testable. Names match
// exactly (case-insensitive, trimmed) — substring matching could silently bind
// a different device than the user meant ("CABLE Input" vs "CABLE Input 16ch").

export interface RequestedAudioDeviceNames {
  inputName?: string | undefined
  outputName?: string | undefined
}

export interface AudioDeviceSelection {
  input?: CpalDevice
  output?: CpalDevice
}

export function findDeviceByName(
  devices: readonly CpalEnumeratedDevice[],
  name: string,
): CpalEnumeratedDevice | null {
  const wanted = normalizeDeviceName(name)
  return devices.find((device) => normalizeDeviceName(device.name) === wanted) ?? null
}

export function resolveAudioDevices(
  logger: Logger,
  requested: RequestedAudioDeviceNames,
  listDevices: () => readonly CpalEnumeratedDevice[],
): AudioDeviceSelection {
  const selection: AudioDeviceSelection = {}
  if (requested.inputName === undefined && requested.outputName === undefined) return selection

  const devices = listDevices()
  if (requested.inputName !== undefined) {
    const input = findDeviceByName(devices, requested.inputName)
    if (input === null) logMissingDevice(logger, 'input', requested.inputName, devices)
    else selection.input = input
  }
  if (requested.outputName !== undefined) {
    const output = findDeviceByName(devices, requested.outputName)
    if (output === null) logMissingDevice(logger, 'output', requested.outputName, devices)
    else selection.output = output
  }
  return selection
}

export interface SelectedDeviceConfig {
  device: CpalDevice
  config: CpalStreamConfig
}

// A name can resolve and STILL be unusable in the requested direction —
// enumeration carries no capability flags (only the is-default booleans), and
// VB-Cable's ends invert (you record from "CABLE Output", play into "CABLE
// Input"). So probe the selected device's config and fall back to the system
// default, loudly, when the direction isn't supported: a wrong-direction name
// must not take the daemon down any more than a missing one. A broken DEFAULT
// device still propagates — that is today's fail-fast behavior, unchanged.
export function selectDeviceConfig(
  logger: Logger,
  direction: 'input' | 'output',
  selected: CpalDevice | undefined,
  getDefaultDevice: () => CpalDevice,
  getConfig: (deviceId: string) => CpalStreamConfig,
): SelectedDeviceConfig {
  if (selected !== undefined) {
    try {
      return { device: selected, config: getConfig(selected.deviceId) }
    } catch (error) {
      logger.error(
        {
          device: selected.name,
          direction,
          error: error instanceof Error ? error.message : String(error),
        },
        `configured ${direction} device can't ${direction === 'input' ? 'record' : 'play'} — ` +
          'likely the other end of the cable; falling back to the system default',
      )
    }
  }
  const device = getDefaultDevice()
  return { device, config: getConfig(device.deviceId) }
}

function normalizeDeviceName(name: string): string {
  return name.trim().toLowerCase()
}

// A configured-but-missing device must not take the daemon down — the cable it
// names may simply not be installed yet. Fall back to the system default, loudly.
function logMissingDevice(
  logger: Logger,
  direction: 'input' | 'output',
  requestedName: string,
  devices: readonly CpalEnumeratedDevice[],
): void {
  logger.error(
    { requestedName, direction, availableDevices: devices.map((device) => device.name) },
    `configured ${direction} device not found — falling back to the system default; ` +
      'fix the name (see availableDevices) or unset the env var',
  )
}
