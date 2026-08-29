import type { CpalEnumeratedDevice } from './cpal.js'

// What the daemon can actually BIND, as a list a picker can show.
//
// Why this exists: Settings → Voice lists devices as the BROWSER enumerates
// them, but the wake word runs HERE, on cpal. The two lists usually agree —
// same hardware, same names — but only usually: the browser hides names behind
// permission, invents its own "default" pseudo-entries, and cannot see a device
// another process holds exclusively. A pick made from the browser's list that
// this side cannot bind is the failure the name-matching contract exists to
// make visible, so the picker can ask THIS side what it really has.
//
// NOTE on shape: cpal's enumeration carries no direction — only which device is
// the default INPUT and which the default OUTPUT. So this returns one list with
// those two flags rather than pretending to split microphones from speakers.
// Direction is settled by probing at open time (`selectDeviceConfig`), which
// already falls back loudly when a name is bound the wrong way round.
//
// Pure on purpose, like `device-selection`: it takes the enumerated list and
// never touches the native binding, so the shaping stays unit-testable.

export interface DaemonAudioDevice {
  /** The exact name a saved pick is matched against. */
  readonly name: string
  readonly isDefaultInput: boolean
  readonly isDefaultOutput: boolean
}

/** One of the call driver's own endpoints ("Vynel Call 1 Microphone (Vynel
 *  Audio)"). They are plumbing for a call, never a room microphone — and
 *  Windows makes a freshly installed one the default recording device, so
 *  listing them invites exactly the wrong choice. */
function isCallDriverEndpoint(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized.includes('(vynel audio)') || /^vynel call \d+ /.test(normalized)
}

export function toDaemonAudioInventory(
  devices: readonly CpalEnumeratedDevice[],
): DaemonAudioDevice[] {
  const seen = new Set<string>()
  const inventory: DaemonAudioDevice[] = []
  for (const device of devices) {
    // A nameless device cannot be picked (the pick travels as a name), and the
    // same endpoint can enumerate twice across hosts.
    if (device.name === '' || seen.has(device.name)) continue
    if (isCallDriverEndpoint(device.name)) continue
    seen.add(device.name)
    inventory.push({
      name: device.name,
      isDefaultInput: device.isDefaultInput,
      isDefaultOutput: device.isDefaultOutput,
    })
  }
  return inventory
}
