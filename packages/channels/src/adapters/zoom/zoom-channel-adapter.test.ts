// Tests for `ZoomChannelAdapter` + its event socket. The network boundary
// (fetch + WebSocket) is faked — NOT the DB (the adapter is DB-free), per
// the telegram-adapter precedent.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZoomChannelAdapter } from './zoom-channel-adapter.js'
import { normalizeBotNotification, ZOOM_SOCKET_OPEN } from './zoom-event-socket.js'
import type { ZoomSocket } from './zoom-event-socket.js'

// No accountId — the adapter detects it from the token's `aid` claim (the
// console barely surfaces it; a typed value is only an override).
const credentials = {
  clientId: 'cid',
  clientSecret: 'shh-secret',
  botJid: 'v1robot@xmpp.zoom.us',
  subscriptionId: 'sub-1',
}

// A JWT-shaped access token whose payload carries the account id claim.
function fakeJwt(aid = 'acc-1'): string {
  return `head.${Buffer.from(JSON.stringify({ aid })).toString('base64url')}.sig`
}

class FakeZoomSocket implements ZoomSocket {
  readyState = ZOOM_SOCKET_OPEN
  url: string
  sent: string[] = []
  private listeners = new Map<string, ((data?: unknown) => void)[]>()

  constructor(url: string) {
    this.url = url
  }

  on(event: string, listener: (data?: unknown) => void): void {
    const existing = this.listeners.get(event) ?? []
    this.listeners.set(event, [...existing, listener])
  }

  emit(event: string, data?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(data)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }
}

function tokenResponse(token = fakeJwt()): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), { status: 200 })
}

function makeHarness() {
  const sockets: FakeZoomSocket[] = []
  const fetchFn = vi.fn(async () => tokenResponse())
  const adapter = new ZoomChannelAdapter(fetchFn as unknown as typeof fetch, (url) => {
    const socket = new FakeZoomSocket(url)
    sockets.push(socket)
    return socket
  })
  return { adapter, fetchFn, sockets }
}

function botNotificationFrame(payload: Record<string, unknown>): string {
  return JSON.stringify({
    module: 'message',
    content: JSON.stringify({ event: 'bot_notification', payload }),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ZoomChannelAdapter', () => {
  it('capabilities: editing yes, buttons/typing no (v1)', () => {
    const { adapter } = makeHarness()
    expect(adapter.channelKind).toBe('zoom')
    expect(adapter.supportsMessageEditing()).toBe(true)
    expect(adapter.supportsInlineButtons()).toBe(false)
    expect(adapter.supportsTypingIndicator()).toBe(false)
  })

  it('verifyCredentials: a successful token grant is valid; a rejected one carries no secret', async () => {
    const { adapter } = makeHarness()
    const valid = await adapter.verifyCredentials({ botCredentials: credentials })
    expect(valid.kind).toBe('valid')
    if (valid.kind === 'valid') {
      expect(valid.botHandle).toBe('v1robot@xmpp.zoom.us')
      expect(valid.botMetadata.accountId).toBe('acc-1')
    }

    const failing = new ZoomChannelAdapter(
      vi.fn(async () => new Response('invalid client', { status: 401 })) as unknown as typeof fetch,
      () => new FakeZoomSocket('unused'),
    )
    const invalid = await failing.verifyCredentials({ botCredentials: credentials })
    expect(invalid.kind).toBe('invalid')
    if (invalid.kind === 'invalid') {
      expect(invalid.reasonMessage).toContain('401')
      expect(invalid.reasonMessage).not.toContain('shh-secret')
    }
  })

  it('a typed accountId OVERRIDES the token claim; an underivable one fails actionably', async () => {
    const overrideCalls: { url: string; init: RequestInit }[] = []
    const overrideFetch = vi.fn(async (url: string, init?: RequestInit) => {
      overrideCalls.push({ url, init: init ?? {} })
      if (url.includes('oauth/token')) return tokenResponse()
      return new Response(JSON.stringify({ message_id: 'zm-1' }), { status: 200 })
    })
    const adapter = new ZoomChannelAdapter(
      overrideFetch as unknown as typeof fetch,
      () => new FakeZoomSocket('unused'),
    )
    await adapter.sendMessage({
      botCredentials: { ...credentials, accountId: 'acc-typed' },
      recipientId: 'u@x',
      chatContextId: 'u@x',
      messageBody: 'hi',
      messageStructure: {},
    })
    const send = overrideCalls.find((c) => c.url.includes('/im/chat/messages'))!
    expect((JSON.parse(String(send.init.body)) as { account_id: string }).account_id).toBe(
      'acc-typed',
    )

    // Opaque (non-JWT) token + nothing typed: connect still SUCCEEDS (the
    // account id arrives with the first bot_notification); only an actual
    // SEND before any inbound rejects, actionably.
    const opaque = new ZoomChannelAdapter(
      vi.fn(async () => tokenResponse('opaque-token')) as unknown as typeof fetch,
      () => new FakeZoomSocket('unused'),
    )
    const result = await opaque.verifyCredentials({ botCredentials: credentials })
    expect(result.kind).toBe('valid')
    if (result.kind === 'valid') expect(result.botMetadata.accountId).toBeNull()
    await expect(
      opaque.sendMessage({
        botCredentials: credentials,
        recipientId: 'u@x',
        chatContextId: 'u@x',
        messageBody: 'hi',
        messageStructure: {},
      }),
    ).rejects.toThrow(/Account ID/)
  })

  it('LEARNS the account id from the first bot_notification when the token lacks it', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} })
      if (url.includes('oauth/token')) return tokenResponse('opaque-token')
      return new Response(JSON.stringify({ message_id: 'zm-1' }), { status: 200 })
    })
    const sockets: FakeZoomSocket[] = []
    const adapter = new ZoomChannelAdapter(fetchFn as unknown as typeof fetch, (url) => {
      const socket = new FakeZoomSocket(url)
      sockets.push(socket)
      return socket
    })

    await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
    sockets[0]!.emit(
      'message',
      botNotificationFrame({
        robotJid: credentials.botJid,
        accountId: 'acc-learned',
        toJid: 'user77@xmpp.zoom.us',
        userJid: 'user77@xmpp.zoom.us',
        cmd: 'hello',
        timestamp: 1_784_800_000_000,
      }),
    )
    const drained = await adapter.pollForInboundMessages({
      channelId: 'ch-1',
      botCredentials: credentials,
    })
    expect(drained.messages).toHaveLength(1)

    // The reply now knows the account id nobody ever typed.
    await adapter.sendMessage({
      botCredentials: credentials,
      recipientId: 'user77@xmpp.zoom.us',
      chatContextId: 'user77@xmpp.zoom.us',
      messageBody: 'hi back',
      messageStructure: {},
    })
    const send = calls.find((c) => c.url.includes('/im/chat/messages'))!
    expect((JSON.parse(String(send.init.body)) as { account_id: string }).account_id).toBe(
      'acc-learned',
    )
  })

  it('missing credential keys are rejected before any network call', async () => {
    const { adapter, fetchFn } = makeHarness()
    const result = await adapter.verifyCredentials({
      botCredentials: { clientId: 'cid', clientSecret: 's' },
    })
    expect(result.kind).toBe('invalid')
    if (result.kind === 'invalid') expect(result.reasonMessage).toContain('botJid')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('poll opens ONE socket (token in the url), buffers pushed events, drains them in order', async () => {
    const { adapter, sockets } = makeHarness()
    const first = await adapter.pollForInboundMessages({
      channelId: 'ch-1',
      botCredentials: credentials,
    })
    expect(first.messages).toHaveLength(0)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.url).toContain('subscriptionId=sub-1')
    expect(sockets[0]!.url).toContain('access_token=head.')

    sockets[0]!.emit(
      'message',
      botNotificationFrame({
        robotJid: credentials.botJid,
        toJid: 'user77@xmpp.zoom.us',
        userJid: 'user77@xmpp.zoom.us',
        userName: 'KAFI',
        cmd: 'hello from zoom',
        timestamp: 1_784_800_000_000,
      }),
    )
    const second = await adapter.pollForInboundMessages({
      channelId: 'ch-1',
      botCredentials: credentials,
    })
    // Same open socket reused — no reconnect, and the buffer drained once.
    expect(sockets).toHaveLength(1)
    expect(second.messages).toHaveLength(1)
    expect(second.messages[0]).toMatchObject({
      externalSenderId: 'user77@xmpp.zoom.us',
      externalSenderDisplayName: 'KAFI',
      chatContextKind: 'dm',
      isBotMentioned: true,
      messageBody: 'hello from zoom',
    })
    const third = await adapter.pollForInboundMessages({
      channelId: 'ch-1',
      botCredentials: credentials,
    })
    expect(third.messages).toHaveLength(0)
  })

  it('a dead socket is recreated on the next poll (no replay — buffer just resumes)', async () => {
    const { adapter, sockets } = makeHarness()
    await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
    sockets[0]!.readyState = 3 // dropped
    await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
    expect(sockets).toHaveLength(2)
  })

  it('a still-CONNECTING socket is NOT torn down each tick (no token-grant loop)', async () => {
    const { adapter, fetchFn, sockets } = makeHarness()
    await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
    sockets[0]!.readyState = 0 // real ws starts CONNECTING; handshake in flight
    await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
    expect(sockets).toHaveLength(1) // within the grace window: left alone
    expect(fetchFn).toHaveBeenCalledTimes(1) // ONE token grant total
  })

  it('the LAST channel is reaped by the self-scheduled timer when polling stops', async () => {
    vi.useFakeTimers()
    try {
      const { adapter, sockets } = makeHarness()
      await adapter.pollForInboundMessages({ channelId: 'ch-1', botCredentials: credentials })
      expect(sockets[0]!.readyState).toBe(ZOOM_SOCKET_OPEN)
      // No further polls (channel disabled). Past the idle window the
      // reap timer closes the socket — nothing lives until process exit.
      await vi.advanceTimersByTimeAsync(2 * 60_001)
      expect(sockets[0]!.readyState).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sendMessage posts the chatbot message (markdown + reply threading) and reuses its token', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} })
      if (url.includes('oauth/token')) return tokenResponse()
      return new Response(JSON.stringify({ message_id: 'zm-9' }), { status: 200 })
    })
    const adapter = new ZoomChannelAdapter(
      fetchFn as unknown as typeof fetch,
      () => new FakeZoomSocket('unused'),
    )
    const sent = await adapter.sendMessage({
      botCredentials: credentials,
      recipientId: 'user77@xmpp.zoom.us',
      chatContextId: 'room@conference.xmpp.zoom.us',
      messageBody: '**done**',
      messageStructure: { parseMode: 'markdown', replyToExternalMessageId: 'zm-1' },
    })
    expect(sent.externalSentMessageId).toBe('zm-9')
    const send = calls.find((c) => c.url.includes('/im/chat/messages'))!
    const body = JSON.parse(String(send.init.body)) as Record<string, unknown>
    expect(body.robot_jid).toBe(credentials.botJid)
    // The account id came off the token's `aid` claim — nobody typed it.
    expect(body.account_id).toBe('acc-1')
    expect(body.to_jid).toBe('room@conference.xmpp.zoom.us')
    expect(body.is_markdown_support).toBe(true)
    expect(body.reply_to).toBe('zm-1')

    await adapter.sendMessage({
      botCredentials: credentials,
      recipientId: 'user77@xmpp.zoom.us',
      chatContextId: 'user77@xmpp.zoom.us',
      messageBody: 'again',
      messageStructure: {},
    })
    // ONE token grant across both sends (cached until near-expiry).
    expect(calls.filter((c) => c.url.includes('oauth/token'))).toHaveLength(1)
  })
})

describe('normalizeBotNotification', () => {
  const identity = { robotJid: credentials.botJid, accountId: 'acc-1' }

  it('a channel toJid reads as a GROUP with its channelName as title', () => {
    const message = normalizeBotNotification(
      {
        robotJid: credentials.botJid,
        toJid: 'room1@conference.xmpp.zoom.us',
        userJid: 'user77@xmpp.zoom.us',
        userName: 'KAFI',
        channelName: 'Launch Room',
        cmd: 'status update please',
        timestamp: 1_784_800_000_000,
        messageId: 'zm-3',
      },
      identity,
    )
    expect(message).toMatchObject({
      externalMessageId: 'zm-3',
      externalChatContextId: 'room1@conference.xmpp.zoom.us',
      chatContextKind: 'group',
      chatContextTitle: 'Launch Room',
      isBotMentioned: true,
    })
  })

  it('drops another robot’s frames, empty text, and malformed payloads', () => {
    expect(
      normalizeBotNotification(
        { robotJid: 'other@xmpp.zoom.us', toJid: 'u@x', userJid: 'u@x', cmd: 'hi' },
        identity,
      ),
    ).toBeNull()
    expect(
      normalizeBotNotification(
        { robotJid: credentials.botJid, toJid: 'u@x', userJid: 'u@x', cmd: '   ' },
        identity,
      ),
    ).toBeNull()
    expect(normalizeBotNotification('not-an-object', identity)).toBeNull()
  })

  it('a missing messageId falls back to a stable synthetic id (dedup key)', () => {
    const message = normalizeBotNotification(
      {
        robotJid: credentials.botJid,
        toJid: 'user77@xmpp.zoom.us',
        userJid: 'user77@xmpp.zoom.us',
        cmd: 'hello',
        timestamp: 1_784_800_000_000,
      },
      identity,
    )
    expect(message?.externalMessageId).toBe('zn:1784800000000:user77@xmpp.zoom.us')
  })
})
