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

// Re-exported for route/integration tests that seed a channel for a SPECIFIC
// owner/scope directly (the production barrel keeps repositories internal) —
// the `@vynel/schedules/test-support` `insertSchedule` precedent.
export { insertChannel, insertChannelChatGroup } from './repositories/index.js'
export type { NewChannel } from './repositories/index.js'

// The outbound-queue reader — lets a cross-domain integration test (e.g.
// schedules → channels delivery) assert the row a channel enqueued, without
// widening the production barrel. Reads ALL statuses for the channel.
export { listOutboundMessagesForChannel } from './repositories/index.js'
export type { ChannelMessageQueueEntry } from './repositories/index.js'

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

// A pending chat-turn that arrived FROM A GROUP ROOM: chat context ≠ sender,
// and the tick-stamped sender/room facts ride the metadata
// (channels-groups.md — the routing slice reads them for attribution).
export function insertPendingGroupChatTurnMessage(
  db: Database,
  channelId: string,
  messageBody = '@bot what did the supplier email about?',
): ChannelInboundMessage {
  return channelsRepository.insertInboundMessage(db, {
    id: randomUUID(),
    channelId,
    externalMessageId: `m-${randomUUID()}`,
    externalSenderId: 'alice-1',
    externalChatContextId: '-100777',
    messageBody,
    messageMetadata: JSON.stringify({
      senderHandle: 'alice',
      senderDisplayName: 'Alice',
      chatContextKind: 'group',
      chatContextTitle: 'Marketing Team',
    }),
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
  origin: {
    channelId: string
    externalSenderId: string
    externalChatContextId: string
    externalMessageId?: string
  }
  /** The per-message reply instruction (channel pipeline, 2026-07-27). */
  channelReplyMarker?: string
}

export interface StubTurnDeps extends ProcessInboundDeps {
  state: { rootTurnCalls: StubRootTurnCall[] }
}

export function stubTurnDeps(
  options: {
    rootTurnResultText?: string
    rootTurnThrows?: boolean
    /** Surface-up: the stub turn "cards" this tool mid-turn — it invokes the caller's
     *  `onApprovalRequested` before resolving, like a brain turn whose own tool parked. */
    emitApproval?: { approvalRequestId: string; toolName: string; toolInput: unknown }
  } = {},
): StubTurnDeps {
  const state: StubTurnDeps['state'] = { rootTurnCalls: [] }
  return {
    appRequest: () => new Response(null),
    // Ch4: route-as-chat-turn runs the global root via this dep — record the call (origin) and
    // return a configurable answer (or throw, for the failure path).
    runRootTurn: (_db, input) => {
      state.rootTurnCalls.push(input)
      if (options.emitApproval !== undefined) input.onApprovalRequested?.(options.emitApproval)
      if (options.rootTurnThrows) return Promise.reject(new Error('root turn exploded'))
      return Promise.resolve({ resultText: options.rootTurnResultText ?? 'On it.' })
    },
    // route-as-approval-reply resolves via this injected dep — a no-op stub here (these turn-path
    // tests exercise only the chat-turn route; the approval path has its own focused test).
    resolveApproval: () => Promise.resolve({}),
    state,
  }
}
