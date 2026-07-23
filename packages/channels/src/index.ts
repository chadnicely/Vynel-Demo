// Public surface of `@vynel/channels` — the channels leaf. Consumers reach the
// package only through this barrel; schema, repositories, adapters and the
// concern folders are internal (imported relatively).

// `extractErrorMessage` — scrubs bot-token-shaped substrings; exported so
// the api-side service's loop error handlers log a scrubbed message too
// (never a raw `err` that could embed the token — coding.md §1.1 / Gate-3 C1).
export { extractErrorMessage } from './adapters/extract-error-message.js'

// Domain types (StructuralLogger, AppRequestFn, ProcessInboundDeps + the
// re-exported adapter contract types).
export type {
  StructuralLogger,
  AppRequestFn,
  ProcessInboundDeps,
  BotCredentials,
  VerifyCredentialsResult,
  NormalizedInboundMessage,
  NormalizedMessageStructure,
} from './channels-types.js'

// The channel row shape — consumers (apps/local-api serializer) type the
// value they serialize; the ops below return it. Repos + schema stay internal.
export type { Channel } from './repositories/index.js'

// Outbox event contract — lifecycle event type constants + payloads
// (future subscribers deserialize against these; Phase 1 consumers: none).
export {
  CHANNEL_CONNECTED,
  CHANNEL_DISCONNECTED,
  CHANNEL_ENABLED_CHANGED,
  CHANNEL_RENAMED,
} from './channels-events.js'
export type {
  ChannelConnectedPayload,
  ChannelDisconnectedPayload,
  ChannelEnabledChangedPayload,
  ChannelRenamedPayload,
} from './channels-events.js'

// Connect / list / allowlist / enable ops.
export { connectChannel, type ConnectChannelInput } from './lifecycle/connect-channel.js'
export { disconnectChannel } from './lifecycle/disconnect-channel.js'
export { listChannelsForWorkspace } from './queries/list-channels-for-workspace.js'
export { setChannelEnabled } from './lifecycle/set-channel-enabled.js'
export { addAllowedSender, type AddAllowedSenderInput } from './senders/add-allowed-sender.js'
export { removeAllowedSender } from './senders/remove-allowed-sender.js'
export { listAllowedSendersForChannel } from './senders/list-allowed-senders-for-channel.js'
export { listChannelHistory, type ListChannelHistoryInput } from './queries/list-channel-history.js'

// Ch4 (channel-aware I/O): queue a reply back to a channel sender — the global-root turn's
// direct answer (route-as-chat-turn) and a delegation's report (the claim-and-run tick) both use it.
export { enqueueChannelReply, type EnqueueChannelReplyInput } from './delivery/enqueue-channel-reply.js'

// Ch4 §D (the send_to_channel tool): the global root's user-scoped channel list + its
// proactive push to a channel (resolves the owner recipient + enqueues).
export { listChannelsForUser } from './queries/list-channels-for-user.js'
export { sendToChannel, type SendToChannelInput } from './delivery/send-to-channel.js'

// User-scoped single-channel ops — the `/channels` HTTP surface (a user's
// global + workspace channels alike). Each authorizes by (userId, channelId)
// via `getChannelForUserOrThrow` — `userId` is the tenant boundary.
export { getChannelForUserOrThrow } from './queries/get-channel-for-user.js'
export { setChannelEnabledForUser } from './lifecycle/set-channel-enabled-for-user.js'
export { renameChannelForUser } from './lifecycle/rename-channel-for-user.js'
export { disconnectChannelForUser } from './lifecycle/disconnect-channel-for-user.js'
export {
  addAllowedSenderForUser,
  type AddAllowedSenderForUserInput,
} from './senders/add-allowed-sender-for-user.js'
export { removeAllowedSenderForUser } from './senders/remove-allowed-sender-for-user.js'
export { listAllowedSendersForUser } from './senders/list-allowed-senders-for-user.js'
export {
  listChannelHistoryForUser,
  type ListChannelHistoryForUserInput,
} from './queries/list-channel-history-for-user.js'

// The processing entry point (the api-side service claims + fires it per pending row),
// plus the pending-row list the service drains each processing tick to find work.
export { processInboundMessage } from './inbound/process-inbound-message.js'
export { listPendingInboundMessages } from './repositories/index.js'

// The null-safe channel read (the listPendingInboundMessages repo re-export
// precedent) — the delegation claim-and-run tick resolves a job's ORIGIN channel
// with it (gone/disabled/not-owned → warn + skip, never a thrown turn).
export { findChannelById } from './repositories/index.js'

// Surface-up: push an approval card to a delegation's origin recipient (buttons
// carry the explicit approval id; the delivery tick ships it like any outbound).
export {
  enqueueApprovalRequestForRecipient,
  type ChannelApprovalCard,
} from './delivery/enqueue-approval-request.js'

// The two channel ticks that do NOT run a turn — the api-side channels service drives them on
// its poll(5s) / deliver(2s) timers. Polling fetches inbound messages from the channel adapter
// and persists them; delivery drains ready outbound rows via the adapter. Both self-contained
// (poll/send the adapter, persist) — no injected turn deps.
export { runChannelPollingTick } from './inbound/run-channel-polling-tick.js'
export { runChannelDeliveryTick } from './delivery/run-channel-delivery-tick.js'
export {
  purgeTerminalChannelRows,
  type PurgeTerminalChannelRowsInput,
  type PurgeTerminalChannelRowsResult,
} from './lifecycle/purge-terminal-channel-rows.js'

// Cross-domain: the outbox consumers (consumer function + payload shape only;
// the generic relay lives in core and is driven by the api's relay service —
// wired 2026-07-17 with the ask-nudge slice).
export {
  consumeScheduleRunCompletedEvent,
  type ScheduleRunCompletedPayload,
} from './delivery/consume-schedule-run-completed-event.js'
export {
  consumeAskCreatedEvent,
  type AskCreatedPayload,
} from './delivery/consume-ask-created-event.js'
