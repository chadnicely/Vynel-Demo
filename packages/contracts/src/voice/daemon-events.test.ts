import { describe, expect, it } from 'vitest'
import { isVoiceSurface, parseVoiceDaemonEvent } from './daemon-events.js'

describe('voice daemon events', () => {
  it('parses the daemon kinds and drops the rest', () => {
    expect(parseVoiceDaemonEvent({ kind: 'state', state: 'listening' })).toEqual({
      kind: 'state',
      state: 'listening',
    })
    expect(parseVoiceDaemonEvent({ kind: 'wake', command: 'open mail' })).toEqual({
      kind: 'wake',
      command: 'open mail',
    })
    expect(parseVoiceDaemonEvent({ kind: 'wake' })).toEqual({ kind: 'wake', command: '' })
    expect(parseVoiceDaemonEvent({ kind: 'speak', text: 'hello' })).toEqual({
      kind: 'speak',
      text: 'hello',
      sessionId: null,
    })
    expect(parseVoiceDaemonEvent({ kind: 'speak', text: '' })).toBeNull()
    expect(parseVoiceDaemonEvent({ kind: 'dance' })).toBeNull()
    expect(parseVoiceDaemonEvent('nope')).toBeNull()
    expect(parseVoiceDaemonEvent(null)).toBeNull()
  })

  it('carries the wake watchdog bound and the producing session of a speak through the relay', () => {
    // The daemon's knob rides the wake so the browser leg arms the same bound.
    expect(parseVoiceDaemonEvent({ kind: 'wake', command: '', turnWatchdogMs: 300_000 })).toEqual({
      kind: 'wake',
      command: '',
      turnWatchdogMs: 300_000,
    })
    // A garbage bound is dropped, not forwarded — the client falls back to its default.
    expect(parseVoiceDaemonEvent({ kind: 'wake', command: 'hi', turnWatchdogMs: 'soon' })).toEqual({
      kind: 'wake',
      command: 'hi',
    })
    expect(parseVoiceDaemonEvent({ kind: 'speak', text: 'done', sessionId: 'sess-9' })).toEqual({
      kind: 'speak',
      text: 'done',
      sessionId: 'sess-9',
    })
    // An older daemon (or an unknown producer) → null, never a non-string.
    expect(parseVoiceDaemonEvent({ kind: 'speak', text: 'done', sessionId: 42 })).toEqual({
      kind: 'speak',
      text: 'done',
      sessionId: null,
    })
  })

  it('carries show-display, and never invents an api-only frame', () => {
    // A payload-free kind — the daemon is asking, not describing.
    expect(parseVoiceDaemonEvent({ kind: 'show-display' })).toEqual({ kind: 'show-display' })
    // `display-active` and `daemon-link` are the API's own words on the voice
    // channel; a daemon claiming them is not a daemon event.
    expect(parseVoiceDaemonEvent({ kind: 'display-active', active: true })).toBeNull()
    expect(parseVoiceDaemonEvent({ kind: 'daemon-link', connected: true })).toBeNull()
  })

  it('knows the two surfaces', () => {
    expect(isVoiceSurface('app')).toBe(true)
    expect(isVoiceSurface('dock')).toBe(true)
    expect(isVoiceSurface('tv')).toBe(false)
  })
})
