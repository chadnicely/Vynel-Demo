import { describe, expect, it } from 'vitest'
import { detectWakeWord, stripWakePrefix } from './wake-word.js'

describe('detectWakeWord', () => {
  it('detects the wake phrase and returns the command after it', () => {
    expect(detectWakeWord('hey vynel what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
  })

  it('handles punctuation + casing and preserves the command casing', () => {
    expect(detectWakeWord('Hey, Vynel. How many workspaces do I have?')).toEqual({
      detected: true,
      command: 'How many workspaces do I have?',
    })
  })

  it('detects the wake phrase alone (no command)', () => {
    expect(detectWakeWord('hey vynel')).toEqual({ detected: true, command: '' })
    expect(detectWakeWord('Hey Vynel!')).toEqual({ detected: true, command: '' })
  })

  it('tolerates common Whisper mishears of the name', () => {
    expect(detectWakeWord('hey vinel whats up').detected).toBe(true)
    expect(detectWakeWord('hi vynell remind me to call mom').command).toBe('remind me to call mom')
    expect(detectWakeWord('hey vinyl remind me to call mom').command).toBe('remind me to call mom')
  })

  it('wakes on the live "hey fine" mishear tiny STT returns for "hey vynel"', () => {
    expect(detectWakeWord('Hey, fine, hello')).toEqual({ detected: true, command: 'hello' })
  })

  it('detects "hey claude" (the assistant display name) and its mishears', () => {
    expect(detectWakeWord('hey claude what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
    expect(detectWakeWord('Hey Claude!')).toEqual({ detected: true, command: '' })
    expect(detectWakeWord('hey cloud remind me to call mom').command).toBe('remind me to call mom')
    expect(detectWakeWord('hi clawed whats up').detected).toBe(true)
  })

  // The retired name is DELIBERATE residue, not a leftover: the P3 rename moved
  // every surface off it, but dropping it from the ear is a behaviour change —
  // an early user who still says it would simply stop being heard — so it waits
  // on Kafi's product call. Pinned so nobody "tidies" it away by accident, and
  // so removing it is a visible decision (delete this case with the spellings).
  it('still hears the retired name, kept until the product call lands', () => {
    expect(detectWakeWord('hey jarvis what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
    expect(detectWakeWord('hey jervis').detected).toBe(true)
  })

  it('does not fire without the wake phrase', () => {
    expect(detectWakeWord('what time is it')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('hey there how are you')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('')).toEqual({ detected: false, command: '' })
  })

  it('only matches the wake phrase at the START (not mid-sentence)', () => {
    expect(detectWakeWord('tell vynel hello').detected).toBe(false)
  })
})

describe('stripWakePrefix', () => {
  it('strips a leading bare name residue', () => {
    expect(stripWakePrefix('vynel what time is it')).toBe('what time is it')
  })

  it('strips a leading greeting-plus-name residue', () => {
    expect(stripWakePrefix('hey vynel remind me to call mom')).toBe('remind me to call mom')
  })

  it('leaves a clean command untouched', () => {
    expect(stripWakePrefix('what time is it')).toBe('what time is it')
  })
})
