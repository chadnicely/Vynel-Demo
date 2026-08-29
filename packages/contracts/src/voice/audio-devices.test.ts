import { describe, expect, it } from 'vitest'
import {
  AUDIO_DEVICE_NAME_MAX_LENGTH,
  findAudioDeviceByName,
  isValidAudioDeviceName,
  normalizeAudioDeviceName,
} from './audio-devices.js'

const devices = [
  { name: 'Microphone (Realtek High Definition Audio)' },
  { name: 'CABLE Output (VB-Audio Virtual Cable)' },
  { name: 'Speakers (2- USB Audio Device)' },
]

describe('normalizeAudioDeviceName', () => {
  it('trims and lowercases', () => {
    expect(normalizeAudioDeviceName('  CABLE Output ')).toBe('cable output')
  })
})

describe('isValidAudioDeviceName', () => {
  it('accepts a real endpoint name', () => {
    expect(isValidAudioDeviceName('CABLE Output (VB-Audio Virtual Cable)')).toBe(true)
  })

  it('rejects the empty string and whitespace — that is the clear, not a pick', () => {
    expect(isValidAudioDeviceName('')).toBe(false)
    expect(isValidAudioDeviceName('   ')).toBe(false)
  })

  it('rejects a non-string', () => {
    expect(isValidAudioDeviceName(null)).toBe(false)
    expect(isValidAudioDeviceName(7)).toBe(false)
  })

  it('rejects a name past the length bound', () => {
    expect(isValidAudioDeviceName('a'.repeat(AUDIO_DEVICE_NAME_MAX_LENGTH))).toBe(true)
    expect(isValidAudioDeviceName('a'.repeat(AUDIO_DEVICE_NAME_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('findAudioDeviceByName', () => {
  it('finds by exact name', () => {
    expect(findAudioDeviceByName(devices, 'CABLE Output (VB-Audio Virtual Cable)')).toBe(devices[1])
  })

  it('ignores case and surrounding space', () => {
    expect(findAudioDeviceByName(devices, '  cable output (vb-audio virtual cable) ')).toBe(
      devices[1],
    )
  })

  it('never matches on a prefix — a substring hit would bind the wrong device', () => {
    expect(findAudioDeviceByName(devices, 'CABLE Output')).toBeNull()
  })

  it('returns null for a device that is not plugged in', () => {
    expect(findAudioDeviceByName(devices, 'BlackHole 2ch')).toBeNull()
  })
})
