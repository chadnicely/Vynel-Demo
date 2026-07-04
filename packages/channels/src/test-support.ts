// Shared test seeds for the `channels` core tests (per coding.md §8).
// Not imported by production code — compiled but dead at runtime. Takes a
// `db` (the test files own the `withTestDatabase` lifecycle).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import * as channelsRepository from './repositories/index.js'
import type { Database } from '@vynel/db'
import type {
  Channel,
  NewChannel,
  ChannelUserLink,
  ChannelInboundMessage,
} from './repositories/index.js'
import type { ProcessInboundDeps } from './channels-types.js'

export function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

export interface SeededChannel {
  user: { id: string }
  workspace: { id: string }
  channel: Channel
}

export function seedChannel(
  db: Database,
  channelOverrides: Partial<NewChannel> = {},
): SeededChannel {
  const user = insertUser(db, makeUser())
  const workspace = insertWorkspace(db, makeWorkspace(user.id))
  const now = new Date()
  const channel = channelsRepository.insertChannel(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    channelKind: 'telegram',
    displayName: 'Bakery Bot',
    botCredentials: JSON.stringify({ botToken: 'secret-token' }),
    botMetadata: JSON.stringify({ username: 'bakery_bot', id: 42 }),
    connectionStatus: 'healthy',
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...channelOverrides,
  })
  return { user, workspace, channel }
}

export interface SeededChannelWithSender extends SeededChannel {
  sender: ChannelUserLink
}

export function seedChannelWithAllowedSender(
  db: Database,
  externalSenderId = '123456',
): SeededChannelWithSender {
  const seeded = seedChannel(db)
  const sender = channelsRepository.insertAllowedSender(db, {
    id: randomUUID(),
    channelId: seeded.channel.id,
    externalSenderId,
    externalSenderHandle: '@owner',
    externalSenderDisplayName: 'The Owner',
    scopeContextId: externalSenderId,
    addedAt: new Date(),
  })
  return { ...seeded, sender }
}

export function insertPendingChatTurnMessage(
  db: Database,
  channelId: string,
  messageBody = 'what did the supplier email about?',
  externalSenderId = '123456',
): ChannelInboundMessage {
  return channelsRepository.insertInboundMessage(db, {
    id: randomUUID(),
    channelId,
    externalMessageId: `m-${randomUUID()}`,
    externalSenderId,
    externalChatContextId: externalSenderId,
    messageBody,
    messageMetadata: '{}',
    intentKind: 'chat-turn',
    routedToChatSessionId: null,
    routedToApprovalRequestId: null,
    status: 'pending',
    statusMessage: null,
    receivedAt: new Date(),
    processedAt: null,
  })
}

// Stub turn deps — a fake appRequest + a stub runRootTurn that records its calls
// (the Ch4 origin-threading + direct-answer assertions). No vitest import
// (test-support compiles into the package build).
interface StubRootTurnCall {
  userId: string
  userMessageText: string
  origin: { channelId: string; externalSenderId: string; externalChatContextId: string }
}

export interface StubTurnDeps extends ProcessInboundDeps {
  state: { rootTurnCalls: StubRootTurnCall[] }
}

export function stubTurnDeps(
  options: { rootTurnResultText?: string; rootTurnThrows?: boolean } = {},
): StubTurnDeps {
  const state: StubTurnDeps['state'] = { rootTurnCalls: [] }
  return {
    appRequest: () => new Response(null),
    // Ch4: route-as-chat-turn runs the global root via this dep — record the call (origin) and
    // return a configurable answer (or throw, for the failure path).
    runRootTurn: (_db, input) => {
      state.rootTurnCalls.push(input)
      if (options.rootTurnThrows) return Promise.reject(new Error('root turn exploded'))
      return Promise.resolve({ resultText: options.rootTurnResultText ?? 'On it.' })
    },
    // route-as-approval-reply resolves via this injected dep — a no-op stub here (these turn-path
    // tests exercise only the chat-turn route; the approval path has its own focused test).
    resolveApproval: () => Promise.resolve({}),
    state,
  }
}
