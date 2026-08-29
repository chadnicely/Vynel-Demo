import { describe, expect, it } from 'vitest'
import type { CpalEnumeratedDevice } from './cpal.js'
import { toDaemonAudioInventory } from './device-inventory.js'

function enumerated(overrides: Partial<CpalEnumeratedDevice>): CpalEnumeratedDevice {
  return {
    name: 'Microphone (Realtek)',
    deviceId: 'id:mic',
    hostId: 'WASAPI',
    isDefaultInput: false,
    isDefaultOutput: false,
    ...overrides,
  }
}

describe('toDaemonAudioInventory', () => {
  it('carries the name and both default flags', () => {
    const inventory = toDaemonAudioInventory([
      enumerated({ name: 'Microphone (Yeti Stereo Microphone)', isDefaultInput: true }),
      enumerated({ name: 'Speakers (Bose USB Audio)', isDefaultOutput: true }),
    ])

    expect(inventory).toEqual([
      { name: 'Microphone (Yeti Stereo Microphone)', isDefaultInput: true, isDefaultOutput: false },
      { name: 'Speakers (Bose USB Audio)', isDefaultInput: false, isDefaultOutput: true },
    ])
  })

  it("hides the call driver's own endpoints — never a room microphone", () => {
    const inventory = toDaemonAudioInventory([
      enumerated({ name: 'Vynel Call 1 Microphone (Vynel Audio)', isDefaultInput: true }),
      enumerated({ name: 'CABLE Output (Vynel Audio)' }),
      enumerated({ name: 'Microphone (Yeti Stereo Microphone)' }),
    ])

    expect(inventory.map((device) => device.name)).toEqual([
      'Microphone (Yeti Stereo Microphone)',
    ])
  })

  it('drops a nameless device — a pick travels as a name', () => {
    expect(toDaemonAudioInventory([enumerated({ name: '' })])).toEqual([])
  })

  it('lists an endpoint once even when it enumerates across hosts', () => {
    const inventory = toDaemonAudioInventory([
      enumerated({ name: 'Microphone (Yeti Stereo Microphone)', hostId: 'WASAPI' }),
      enumerated({ name: 'Microphone (Yeti Stereo Microphone)', hostId: 'ASIO' }),
    ])

    expect(inventory).toHaveLength(1)
  })
})
