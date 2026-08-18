import { describe, expect, it } from 'vitest'
import { isVoiceSurface, parseVoiceDaemonEvent } from './daemon-events.js'

describe('voice daemon events', () => {
  it('parses the three daemon kinds and drops the rest', () => {
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
    })
    expect(parseVoiceDaemonEvent({ kind: 'speak', text: '' })).toBeNull()
    expect(parseVoiceDaemonEvent({ kind: 'dance' })).toBeNull()
    expect(parseVoiceDaemonEvent('nope')).toBeNull()
    expect(parseVoiceDaemonEvent(null)).toBeNull()
  })

  it('knows the two surfaces', () => {
    expect(isVoiceSurface('app')).toBe(true)
    expect(isVoiceSurface('jarvis')).toBe(true)
    expect(isVoiceSurface('tv')).toBe(false)
  })
})
