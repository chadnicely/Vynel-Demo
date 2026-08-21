// Unit tests for the delegation-origin header codec (brain-tree Ch4) — round-trip + the
// defensive boundary parse (a malformed/absent header is a non-channel origin, never a throw).

import { describe, expect, it } from 'vitest'
import {
  serializeDelegationOrigin,
  parseDelegationOriginHeader,
} from './delegation-origin-header.js'

describe('delegation-origin-header', () => {
  it('round-trips a full origin', () => {
    const origin = { channelId: 'chan-1', externalSenderId: 'tg-42', externalChatContextId: 'chat-7' }
    expect(parseDelegationOriginHeader(serializeDelegationOrigin(origin))).toEqual(origin)
  })

  it('round-trips the turn key a reply is correlated by', () => {
    const origin = {
      channelId: 'chan-1',
      externalSenderId: 'tg-42',
      externalChatContextId: 'chat-7',
      externalMessageId: 'msg-9',
      turnCorrelationId: 'inbound-row-1',
    }
    expect(parseDelegationOriginHeader(serializeDelegationOrigin(origin))).toEqual(origin)
  })

  it('drops a mistyped turn key rather than the whole origin (it only narrows a window)', () => {
    expect(
      parseDelegationOriginHeader(
        '{"channelId":"c","externalSenderId":"s","externalChatContextId":"x","turnCorrelationId":7}',
      ),
    ).toEqual({ channelId: 'c', externalSenderId: 's', externalChatContextId: 'x' })
  })

  it('returns undefined for an absent or empty header (a non-channel origin)', () => {
    expect(parseDelegationOriginHeader(undefined)).toBeUndefined()
    expect(parseDelegationOriginHeader('')).toBeUndefined()
  })

  it('returns undefined for malformed JSON instead of throwing', () => {
    expect(parseDelegationOriginHeader('{not json')).toBeUndefined()
  })

  it('returns undefined when a required field is missing or mistyped', () => {
    expect(parseDelegationOriginHeader('{"channelId":"c","externalSenderId":"s"}')).toBeUndefined()
    expect(
      parseDelegationOriginHeader('{"channelId":1,"externalSenderId":"s","externalChatContextId":"x"}'),
    ).toBeUndefined()
  })
})
