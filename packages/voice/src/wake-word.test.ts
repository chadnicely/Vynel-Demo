import { describe, expect, it } from 'vitest'
import { detectWakeWord, stripWakePrefix } from './wake-word.js'

describe('detectWakeWord', () => {
  it('detects "hey jarvis" and returns the command after it', () => {
    expect(detectWakeWord('hey jarvis what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
  })

  it('handles punctuation + casing and preserves the command casing', () => {
    expect(detectWakeWord('Hey, Jarvis. How many workspaces do I have?')).toEqual({
      detected: true,
      command: 'How many workspaces do I have?',
    })
  })

  it('detects the wake phrase alone (no command)', () => {
    expect(detectWakeWord('hey jarvis')).toEqual({ detected: true, command: '' })
    expect(detectWakeWord('Hey Jarvis!')).toEqual({ detected: true, command: '' })
  })

  it('tolerates common Whisper mishears of the name', () => {
    expect(detectWakeWord('hey jarvas whats up').detected).toBe(true)
    expect(detectWakeWord('hi jervis remind me to call mom').command).toBe('remind me to call mom')
  })

  it('does not fire without the wake phrase', () => {
    expect(detectWakeWord('what time is it')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('hey there how are you')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('')).toEqual({ detected: false, command: '' })
  })

  it('only matches the wake phrase at the START (not mid-sentence)', () => {
    expect(detectWakeWord('tell jarvis hello').detected).toBe(false)
  })
})

describe('stripWakePrefix', () => {
  it('strips a leading bare "jarvis" residue', () => {
    expect(stripWakePrefix('jarvis what time is it')).toBe('what time is it')
  })

  it('strips a leading "hey jarvis" residue', () => {
    expect(stripWakePrefix('hey jarvis remind me to call mom')).toBe('remind me to call mom')
  })

  it('leaves a clean command untouched', () => {
    expect(stripWakePrefix('what time is it')).toBe('what time is it')
  })
})
