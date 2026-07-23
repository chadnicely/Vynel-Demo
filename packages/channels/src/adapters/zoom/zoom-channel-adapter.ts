// `ZoomChannelAdapter` — Zoom Team Chat over the polling `ChannelAdapter`
// contract. Zoom pushes events over a WebSocket (no polling API for bot
// messages), so this adapter is genuinely STATEFUL (class-legal): it owns
// one `ZoomEventSocket` per connected channel, buffers pushed events, and
// `pollForInboundMessages` drains the buffer each tick — zero pipeline
// changes (the recommended shape, channels-zoom.md). Tokens come from the
// client_credentials grant and refresh ahead of expiry by reconnecting.
//
// Credentials bag: { clientId, clientSecret, botJid, accountId,
// subscriptionId } — all strings, opaque to the rest of the system.

import WebSocket from 'ws'
import { ChannelAdapter } from '../channel-adapter.js'
import { extractErrorMessage } from '../extract-error-message.js'
import {
  fetchZoomAccessToken,
  sendZoomChatbotMessage,
  editZoomChatbotMessage,
  type FetchFn,
  type ZoomAccessToken,
} from './zoom-api.js'
import { ZoomEventSocket, type ZoomSocketFactory } from './zoom-event-socket.js'
import type {
  BotCredentials,
  VerifyCredentialsResult,
  NormalizedInboundMessage,
  NormalizedMessageStructure,
} from '../channel-adapter.js'
import type { ChannelKind } from '../../repositories/index.js'

const REQUIRED_CREDENTIAL_KEYS = [
  'clientId',
  'clientSecret',
  'botJid',
  'accountId',
  'subscriptionId',
] as const

type ZoomCredentials = Record<(typeof REQUIRED_CREDENTIAL_KEYS)[number], string>

// A connection unpolled this long belongs to a disabled/disconnected
// channel — reap it (the poll tick is the liveness signal).
const IDLE_CONNECTION_REAP_MS = 60_000

interface ZoomChannelConnection {
  socket: ZoomEventSocket
  token: ZoomAccessToken | null
  lastPolledAtMs: number
}

export class ZoomChannelAdapter extends ChannelAdapter {
  readonly channelKind: ChannelKind = 'zoom'

  private readonly connections = new Map<string, ZoomChannelConnection>()
  // Send/edit token cache per app (keyed by clientId) — the delivery tick
  // must not pay a token grant per outbound message.
  private readonly sendTokens = new Map<string, ZoomAccessToken>()
  // Self-scheduled reaper: when the LAST zoom channel is disabled, no poll
  // ever fires again — without this timer its socket + heartbeat would
  // live (and buffer) until process exit. unref'd so it never holds the
  // process open; cleared when the map empties.
  private reapTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly fetchFn: FetchFn = (...args) => globalThis.fetch(...args),
    private readonly socketFactory: ZoomSocketFactory = (url) =>
      new WebSocket(url) as unknown as ReturnType<ZoomSocketFactory>,
  ) {
    super()
  }

  private requireCredentials(botCredentials: BotCredentials): ZoomCredentials {
    for (const key of REQUIRED_CREDENTIAL_KEYS) {
      if (typeof botCredentials[key] !== 'string' || botCredentials[key] === '') {
        throw new Error(`zoom credentials missing ${key}`)
      }
    }
    return botCredentials as ZoomCredentials
  }

  async verifyCredentials(input: {
    botCredentials: BotCredentials
  }): Promise<VerifyCredentialsResult> {
    try {
      const credentials = this.requireCredentials(input.botCredentials)
      await fetchZoomAccessToken(credentials, this.fetchFn)
      // Zoom has no cheap "who am I" for chatbots — a successful grant IS
      // the verification; identity facts come from the credential bag.
      return {
        kind: 'valid',
        botDisplayName: 'Zoom Team Chat',
        botHandle: credentials.botJid,
        botMetadata: {
          botJid: credentials.botJid,
          accountId: credentials.accountId,
          subscriptionId: credentials.subscriptionId,
        },
      }
    } catch (err) {
      return { kind: 'invalid', reasonMessage: extractErrorMessage(err) }
    }
  }

  async pollForInboundMessages(input: {
    channelId: string
    botCredentials: BotCredentials
    sinceCursor?: string
    botIdentity?: { externalId: string; handle: string }
  }): Promise<{ messages: NormalizedInboundMessage[]; nextCursor: string }> {
    const credentials = this.requireCredentials(input.botCredentials)
    const connection = await this.ensureConnection(input.channelId, credentials)
    connection.lastPolledAtMs = Date.now()
    this.reapIdleConnections(input.channelId)
    this.ensureReapTimer()
    return {
      messages: connection.socket.drainMessages(),
      // Zoom pushes — there is no replayable offset. The cursor is
      // vestigial and simply carried through.
      nextCursor: input.sinceCursor ?? '0',
    }
  }

  private async ensureConnection(
    channelId: string,
    credentials: ZoomCredentials,
  ): Promise<ZoomChannelConnection> {
    let connection = this.connections.get(channelId)
    if (connection === undefined) {
      connection = {
        socket: new ZoomEventSocket(
          { robotJid: credentials.botJid, accountId: credentials.accountId },
          this.socketFactory,
        ),
        token: null,
        lastPolledAtMs: Date.now(),
      }
      this.connections.set(channelId, connection)
    }
    const tokenExpired = connection.token === null || Date.now() >= connection.token.expiresAtMs
    if (!connection.socket.isAlive() || tokenExpired) {
      // (Re)connect with a fresh token — covers first poll, expiry, and any
      // dropped socket. Events missed while down are LOST (Zoom no-replay).
      connection.token = await fetchZoomAccessToken(credentials, this.fetchFn)
      connection.socket.connect(credentials.subscriptionId, connection.token.accessToken)
    }
    return connection
  }

  // A channel that stops being polled (disabled / disconnected) must not
  // keep a socket + heartbeat alive forever — reap connections unpolled
  // past the idle window. Called with the just-polled channel exempt, and
  // from the self-scheduled timer with no exemption (covering the LAST
  // channel, which has no peer left to poll on its behalf).
  private reapIdleConnections(currentChannelId: string | null): void {
    const now = Date.now()
    for (const [channelId, connection] of this.connections) {
      if (channelId === currentChannelId) continue
      if (now - connection.lastPolledAtMs > IDLE_CONNECTION_REAP_MS) {
        connection.socket.close()
        this.connections.delete(channelId)
      }
    }
    if (this.connections.size === 0 && this.reapTimer !== undefined) {
      clearInterval(this.reapTimer)
      this.reapTimer = undefined
    }
  }

  private ensureReapTimer(): void {
    if (this.reapTimer !== undefined) return
    this.reapTimer = setInterval(() => this.reapIdleConnections(null), IDLE_CONNECTION_REAP_MS)
    this.reapTimer.unref?.()
  }

  private async freshSendToken(credentials: ZoomCredentials): Promise<ZoomAccessToken> {
    const cached = this.sendTokens.get(credentials.clientId)
    if (cached !== undefined && Date.now() < cached.expiresAtMs) return cached
    const token = await fetchZoomAccessToken(credentials, this.fetchFn)
    this.sendTokens.set(credentials.clientId, token)
    return token
  }

  async sendMessage(input: {
    botCredentials: BotCredentials
    recipientId: string
    chatContextId: string
    messageBody: string
    messageStructure: NormalizedMessageStructure
  }): Promise<{ externalSentMessageId: string }> {
    const credentials = this.requireCredentials(input.botCredentials)
    const token = await this.freshSendToken(credentials)
    const sent = await sendZoomChatbotMessage(
      {
        accessToken: token.accessToken,
        robotJid: credentials.botJid,
        accountId: credentials.accountId,
        toJid: input.chatContextId,
        text: input.messageBody,
        isMarkdown: input.messageStructure.parseMode === 'markdown',
        ...(input.messageStructure.replyToExternalMessageId !== undefined
          ? { replyToMessageId: input.messageStructure.replyToExternalMessageId }
          : {}),
      },
      this.fetchFn,
    )
    return { externalSentMessageId: sent.messageId }
  }

  async editMessage(input: {
    botCredentials: BotCredentials
    chatContextId: string
    externalMessageId: string
    newMessageBody: string
  }): Promise<void> {
    const credentials = this.requireCredentials(input.botCredentials)
    const token = await this.freshSendToken(credentials)
    await editZoomChatbotMessage(
      {
        accessToken: token.accessToken,
        robotJid: credentials.botJid,
        accountId: credentials.accountId,
        toJid: input.chatContextId,
        text: input.newMessageBody,
        isMarkdown: false,
        messageId: input.externalMessageId,
      },
      this.fetchFn,
    )
  }

  async sendTypingIndicator(): Promise<void> {
    // Zoom has no typing-indicator API — advertised unsupported, so the
    // turn path never calls this; a stray call is a harmless no-op.
  }

  supportsInlineButtons(): boolean {
    // v1: approval cards degrade to typed approve/deny replies. Zoom's
    // interactive messages (actions + interactive_message_actions events)
    // are a recorded follow-up.
    return false
  }

  supportsMessageEditing(): boolean {
    return true
  }

  supportsTypingIndicator(): boolean {
    return false
  }
}
