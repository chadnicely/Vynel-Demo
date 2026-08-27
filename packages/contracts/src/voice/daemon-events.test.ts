import { describe, expect, it } from 'vitest'
import {
  isVoiceSurface,
  parseVoiceControlEvent,
  parseVoiceDaemonEvent,
} from './daemon-events.js'

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

  it('carries show-display and show-dock, and never invents an api-only frame', () => {
    // Payload-free kinds — the daemon is asking, not describing.
    expect(parseVoiceDaemonEvent({ kind: 'show-display' })).toEqual({ kind: 'show-display' })
    expect(parseVoiceDaemonEvent({ kind: 'show-dock' })).toEqual({ kind: 'show-dock' })
    // show-dock may carry the line's opening so the row has a caption even
    // when the audio plays elsewhere; an older daemon omits it.
    expect(parseVoiceDaemonEvent({ kind: 'show-dock', text: 'On my way.' })).toEqual({
      kind: 'show-dock',
      text: 'On my way.',
    })
    // `display-active` and `daemon-link` are the API's own words on the voice
    // channel; a daemon claiming them is not a daemon event.
    expect(parseVoiceDaemonEvent({ kind: 'display-active', active: true })).toBeNull()
    expect(parseVoiceDaemonEvent({ kind: 'daemon-link', connected: true })).toBeNull()
    // The mirror frame is the api's word too — the daemon never holds a room.
    expect(
      parseVoiceDaemonEvent({ kind: 'display-session', live: true, phase: 'listening', caption: '' }),
    ).toBeNull()
  })

  it('knows the two surfaces', () => {
    expect(isVoiceSurface('app')).toBe(true)
    expect(isVoiceSurface('dock')).toBe(true)
    expect(isVoiceSurface('tv')).toBe(false)
  })
})

describe('voice control events', () => {
  it('parses what one window tells the others, and nothing else', () => {
    expect(parseVoiceControlEvent({ kind: 'display-active', active: true })).toEqual({
      kind: 'display-active',
      active: true,
    })
    expect(
      parseVoiceControlEvent({
        kind: 'display-session',
        live: true,
        phase: 'speaking',
        caption: 'Two builds are green',
      }),
    ).toEqual({
      kind: 'display-session',
      live: true,
      phase: 'speaking',
      caption: 'Two builds are green',
    })
    // The stop command — payload-free, one meaning everywhere.
    expect(parseVoiceControlEvent({ kind: 'voice-stop' })).toEqual({ kind: 'voice-stop' })
    // The daemon's own vocabulary goes the other way, through
    // parseVoiceDaemonEvent — this door only knows the api's words.
    expect(parseVoiceControlEvent({ kind: 'state', state: 'listening' })).toBeNull()
    expect(parseVoiceControlEvent({ kind: 'daemon-link', connected: true })).toBeNull()
    expect(parseVoiceControlEvent('nope')).toBeNull()
    expect(parseVoiceControlEvent(null)).toBeNull()
  })

  it('refuses a frame it cannot believe, and tolerates a phase it has not heard of', () => {
    // A non-boolean `active` is DROPPED rather than coerced: a window reading
    // "yes" as true would hide the dock on a frame nobody meant to send.
    expect(parseVoiceControlEvent({ kind: 'display-active', active: 'yes' })).toBeNull()
    expect(parseVoiceControlEvent({ kind: 'display-session', live: 'yes', caption: '' })).toBeNull()
    expect(parseVoiceControlEvent({ kind: 'display-session', live: true, phase: 'idle' })).toBeNull()
    // Version skew: a newer window's phase must not park an older dock's orb
    // in something it cannot interpret.
    expect(
      parseVoiceControlEvent({ kind: 'display-session', live: true, phase: 'dreaming', caption: 'hi' }),
    ).toEqual({ kind: 'display-session', live: true, phase: 'idle', caption: 'hi' })
  })
})
