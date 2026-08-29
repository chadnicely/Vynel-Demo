import type { Logger } from 'pino'
import {
  findAudioDeviceByName,
  normalizeAudioDeviceName,
} from '@vynel/contracts/voice/audio-devices'
import type { CpalDevice, CpalEnumeratedDevice, CpalStreamConfig } from './cpal.js'

// Resolves the user's configured device NAMES (Settings → Voice, or env) to
// concrete cpal devices. Pure on purpose: it takes the enumerated list as an
// input and never imports the native binding, so the fallback rules stay
// unit-testable. The name-matching rules are shared with the browser's capture
// and playback legs — see `@vynel/contracts/voice/audio-devices`.

export interface RequestedAudioDeviceNames {
  inputName?: string | undefined
  outputName?: string | undefined
}

export interface AudioDeviceSelection {
  input?: CpalDevice
  output?: CpalDevice
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
    const input = findAudioDeviceByName(devices, requested.inputName)
    if (input === null) logMissingDevice(logger, 'input', requested.inputName, devices)
    else selection.input = input
  }
  if (requested.outputName !== undefined) {
    const output = findAudioDeviceByName(devices, requested.outputName)
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
  listDevices?: () => readonly CpalEnumeratedDevice[],
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
  if (direction === 'input' && isVynelVirtualDevice(device.name ?? '') && listDevices !== undefined) {
    // Windows makes a freshly installed capture endpoint the default recording
    // device — and Vynel's own call driver ("Vynel Call <n> Microphone (Vynel
    // Audio)") is exactly that. Listening to it for the wake word means
    // hearing nothing from the room, silently. Take the first REAL device that
    // can record instead; only stay on the virtual mic when nothing else can.
    for (const candidate of listDevices()) {
      if (candidate.deviceId === device.deviceId || isVynelVirtualDevice(candidate.name)) continue
      try {
        const config = getConfig(candidate.deviceId)
        logger.warn(
          { defaultDevice: device.name ?? device.deviceId, chosenDevice: candidate.name },
          "the default recording device is Vynel's own virtual call microphone — using the first " +
            'real microphone instead; set VYNEL_VOICE_INPUT_DEVICE to pick one explicitly',
        )
        return { device: candidate, config }
      } catch {
        // not an input (or broken) — try the next
      }
    }
    logger.error(
      { defaultDevice: device.name ?? device.deviceId },
      "the default recording device is Vynel's own virtual call microphone and no other input " +
        'could be opened — the wake word will not be heard; set VYNEL_VOICE_INPUT_DEVICE',
    )
  }
  return { device, config: getConfig(device.deviceId) }
}

/** One of the call driver's own endpoints ("Vynel Call 1 Microphone (Vynel
 *  Audio)", "Vynel Call 1 Speaker (Vynel Audio)") — never a room microphone. */
export function isVynelVirtualDevice(name: string): boolean {
  const normalized = normalizeAudioDeviceName(name)
  return normalized.includes('(vynel audio)') || /^vynel call \d+ /.test(normalized)
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
