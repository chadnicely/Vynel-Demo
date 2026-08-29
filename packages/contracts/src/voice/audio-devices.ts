// WHICH microphone hears you and WHICH speaker answers — the shared rules for
// naming and matching an audio device, used by every leg that can bind one:
// the browser's capture + playback (`apps/local-web`) and the daemon's cpal
// streams (`apps/voice`).
//
// The pick travels as a NAME, never an id. Preferences are per-user while
// devices are per-machine: a browser `deviceId` is origin-scoped and rotates
// whenever permission is reset, and a cpal id is opaque (on WASAPI it merely
// happens to equal the name). A name re-resolves on whatever machine reads it,
// and every consumer falls back to the system default — loudly — when the
// named device is absent, so a pick made on the desktop can never silence a
// laptop.
//
// Matching is exact once trimmed and lowercased. Substring matching would
// silently bind a different device than the user meant ("CABLE Input" vs
// "CABLE Input 16ch").

/** Which half of the conversation a device serves. */
export type AudioDeviceDirection = 'input' | 'output'

export const AUDIO_DEVICE_DIRECTIONS = ['input', 'output'] as const

/** Long enough for the longest real Windows endpoint string
 *  ("CABLE Output (VB-Audio Virtual Cable)" and friends), short enough that a
 *  preference row stays a name and never becomes a payload. */
export const AUDIO_DEVICE_NAME_MAX_LENGTH = 200

/** Anything a device list can be matched against — cpal's enumerated device,
 *  a browser `MediaDeviceInfo`, or a test's plain object. */
export interface NamedAudioDevice {
  readonly name: string
}

export function normalizeAudioDeviceName(name: string): string {
  return name.trim().toLowerCase()
}

/** A stored pick is valid when it survives normalization as a non-empty name
 *  within bounds. The empty string is NOT valid — it is the CLEAR (back to the
 *  system default), which callers map to null before storing. */
export function isValidAudioDeviceName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized = normalizeAudioDeviceName(value)
  return normalized.length > 0 && value.length <= AUDIO_DEVICE_NAME_MAX_LENGTH
}

export function findAudioDeviceByName<Device extends NamedAudioDevice>(
  devices: readonly Device[],
  name: string,
): Device | null {
  const wanted = normalizeAudioDeviceName(name)
  return devices.find((device) => normalizeAudioDeviceName(device.name) === wanted) ?? null
}
