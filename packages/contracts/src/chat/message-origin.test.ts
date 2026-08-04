import { describe, expect, it } from 'vitest'
import { deriveMessageOrigin } from './message-origin.js'

describe('deriveMessageOrigin', () => {
  it('a plain composer message is from the USER', () => {
    expect(
      deriveMessageOrigin({ role: 'user', sourceKind: null, sourceLabel: null, originChannel: null }),
    ).toEqual({ origin: 'user', label: null })
  })

  it('a channel-borne user message is from that CHANNEL', () => {
    expect(
      deriveMessageOrigin({
        role: 'user',
        sourceKind: null,
        sourceLabel: null,
        originChannel: 'telegram',
      }),
    ).toEqual({ origin: 'channel', label: 'telegram' })
  })

  it('a system-relayed inbound (task/report/update) is from a SESSION — even over a channel marker', () => {
    expect(
      deriveMessageOrigin({
        role: 'user',
        sourceKind: 'workspace-manager',
        sourceLabel: 'Mark · Acme',
        originChannel: 'telegram',
      }),
    ).toEqual({ origin: 'session', label: 'Mark · Acme' })
    expect(
      deriveMessageOrigin({
        role: 'user',
        sourceKind: 'agent',
        sourceLabel: 'Nova',
        originChannel: null,
      }),
    ).toEqual({ origin: 'session', label: 'Nova' })
  })

  it('assistant rows always speak as a session — own persona when unattributed', () => {
    expect(
      deriveMessageOrigin({
        role: 'assistant',
        sourceKind: null,
        sourceLabel: null,
        originChannel: null,
      }),
    ).toEqual({ origin: 'session', label: null })
    expect(
      deriveMessageOrigin({
        role: 'assistant',
        sourceKind: 'agent',
        sourceLabel: 'Nova',
        originChannel: null,
      }),
    ).toEqual({ origin: 'session', label: 'Nova' })
  })
})
