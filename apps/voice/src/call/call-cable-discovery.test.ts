import { describe, expect, it } from 'vitest'
import type { CpalEnumeratedDevice } from '../audio/cpal.js'
import { discoverVynelCallPairs } from './call-cable-discovery.js'

function device(name: string): CpalEnumeratedDevice {
  return { name, deviceId: `id:${name}`, hostId: 'WASAPI', isDefaultInput: false, isDefaultOutput: false }
}

describe('discoverVynelCallPairs', () => {
  it('finds nothing among ordinary devices', () => {
    const discovered = discoverVynelCallPairs([
      device('Speakers (Realtek(R) Audio)'),
      device('CABLE Output (VB-Audio Virtual Cable)'),
      device('Microphone Array (Intel Smart Sound)'),
    ])
    expect(discovered.pairs).toEqual([])
    expect(discovered.orphanNames).toEqual([])
  })

  it('claims a complete pair with names verbatim — adapter suffix and all', () => {
    const discovered = discoverVynelCallPairs([
      device('Vynel Call 1 Voice (Vynel Virtual Audio)'),
      device('Vynel Call 1 Ears (Vynel Virtual Audio)'),
    ])
    expect(discovered.pairs).toEqual([
      {
        inputName: 'Vynel Call 1 Ears (Vynel Virtual Audio)',
        outputName: 'Vynel Call 1 Voice (Vynel Virtual Audio)',
      },
    ])
    expect(discovered.orphanNames).toEqual([])
  })

  it('never claims the app-facing Microphone/Speaker ends', () => {
    const discovered = discoverVynelCallPairs([
      device('Vynel Call 1 Microphone (Vynel Virtual Audio)'),
      device('Vynel Call 1 Speaker (Vynel Virtual Audio)'),
    ])
    expect(discovered.pairs).toEqual([])
    expect(discovered.orphanNames).toEqual([])
  })

  it('matches case-insensitively and through padding whitespace', () => {
    const discovered = discoverVynelCallPairs([
      device('  vynel call 3 EARS (X)  '),
      device('VYNEL CALL 3 voice'),
    ])
    expect(discovered.pairs).toHaveLength(1)
    expect(discovered.pairs[0]!.inputName).toBe('  vynel call 3 EARS (X)  ')
  })

  it('orders multiple pairs numerically, not lexically', () => {
    const discovered = discoverVynelCallPairs([
      device('Vynel Call 10 Ears'),
      device('Vynel Call 10 Voice'),
      device('Vynel Call 2 Voice'),
      device('Vynel Call 2 Ears'),
    ])
    expect(discovered.pairs.map((pair) => pair.inputName)).toEqual([
      'Vynel Call 2 Ears',
      'Vynel Call 10 Ears',
    ])
  })

  it('surfaces a partnerless end as an orphan instead of claiming it', () => {
    const discovered = discoverVynelCallPairs([device('Vynel Call 1 Ears')])
    expect(discovered.pairs).toEqual([])
    expect(discovered.orphanNames).toEqual(['Vynel Call 1 Ears'])
  })

  it('keeps the first of two devices claiming the same end, orphaning the extra', () => {
    const discovered = discoverVynelCallPairs([
      device('Vynel Call 1 Ears (A)'),
      device('Vynel Call 1 Ears (B)'),
      device('Vynel Call 1 Voice'),
    ])
    expect(discovered.pairs).toEqual([
      { inputName: 'Vynel Call 1 Ears (A)', outputName: 'Vynel Call 1 Voice' },
    ])
    expect(discovered.orphanNames).toEqual(['Vynel Call 1 Ears (B)'])
  })

  it('requires a word boundary after the direction — "Earsplitter" is not an end', () => {
    const discovered = discoverVynelCallPairs([
      device('Vynel Call 1 Earsplitter'),
      device('Vynel Call 1 Voice'),
    ])
    expect(discovered.pairs).toEqual([])
    expect(discovered.orphanNames).toEqual(['Vynel Call 1 Voice'])
  })
})
