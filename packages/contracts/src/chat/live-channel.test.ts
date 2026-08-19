import { describe, expect, it } from 'vitest'
import {
  liveChannelKeys,
  parseLiveChannelClientMessage,
  parseLiveChannelKey,
} from './live-channel.js'

describe('live-channel keys', () => {
  it('builds and parses the three channel kinds', () => {
    expect(parseLiveChannelKey(liveChannelKeys.activity)).toEqual({ kind: 'activity' })
    expect(parseLiveChannelKey(liveChannelKeys.session('s1'))).toEqual({
      kind: 'session',
      sessionId: 's1',
    })
    expect(parseLiveChannelKey(liveChannelKeys.trace('p1'))).toEqual({
      kind: 'trace',
      partialSessionId: 'p1',
    })
  })

  it('parses the two voice surfaces, with or without the wake capability, and nothing else under voice:', () => {
    expect(parseLiveChannelKey(liveChannelKeys.voice({ surface: 'app', wake: false }))).toEqual({
      kind: 'voice',
      surface: 'app',
      wake: false,
    })
    expect(liveChannelKeys.voice({ surface: 'jarvis', wake: true })).toBe('voice:jarvis:wake')
    expect(parseLiveChannelKey('voice:jarvis:wake')).toEqual({
      kind: 'voice',
      surface: 'jarvis',
      wake: true,
    })
    expect(parseLiveChannelKey('voice:jarvis')).toEqual({ kind: 'voice', surface: 'jarvis', wake: false })
    expect(parseLiveChannelKey('voice:tv')).toBeNull()
    expect(parseLiveChannelKey('voice:tv:wake')).toBeNull()
    expect(parseLiveChannelKey('voice:app:mic')).toBeNull()
    expect(parseLiveChannelKey('voice:app:wake:more')).toBeNull()
    expect(parseLiveChannelKey('voice:')).toBeNull()
  })

  it('rejects unknown and empty keys', () => {
    expect(parseLiveChannelKey('turn:x')).toBeNull()
    expect(parseLiveChannelKey('session:')).toBeNull()
    expect(parseLiveChannelKey('trace:')).toBeNull()
    expect(parseLiveChannelKey('')).toBeNull()
  })
})

describe('parseLiveChannelClientMessage', () => {
  it('accepts subscribe / unsubscribe / pong', () => {
    expect(
      parseLiveChannelClientMessage(JSON.stringify({ op: 'subscribe', channels: ['activity'] })),
    ).toEqual({ op: 'subscribe', channels: ['activity'] })
    expect(
      parseLiveChannelClientMessage(
        JSON.stringify({ op: 'unsubscribe', channels: ['session:a', 'trace:b'] }),
      ),
    ).toEqual({ op: 'unsubscribe', channels: ['session:a', 'trace:b'] })
    expect(parseLiveChannelClientMessage(JSON.stringify({ op: 'pong' }))).toEqual({ op: 'pong' })
  })

  it('returns null for anything malformed (non-JSON, wrong op, non-string channels, binary)', () => {
    expect(parseLiveChannelClientMessage('not json')).toBeNull()
    expect(parseLiveChannelClientMessage(JSON.stringify({ op: 'dance' }))).toBeNull()
    expect(parseLiveChannelClientMessage(JSON.stringify({ op: 'subscribe' }))).toBeNull()
    expect(
      parseLiveChannelClientMessage(JSON.stringify({ op: 'subscribe', channels: [1] })),
    ).toBeNull()
    expect(parseLiveChannelClientMessage(new ArrayBuffer(2))).toBeNull()
    expect(parseLiveChannelClientMessage('null')).toBeNull()
  })
})
