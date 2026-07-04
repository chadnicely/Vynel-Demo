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

// The processing entry point (the api-side service claims + fires it per pending row). The
// polling / delivery TICK runners are the worker-cron composition bodies — deferred to app-wiring.
export { processInboundMessage } from './inbound/process-inbound-message.js'
export {
  purgeTerminalChannelRows,
  type PurgeTerminalChannelRowsInput,
  type PurgeTerminalChannelRowsResult,
} from './lifecycle/purge-terminal-channel-rows.js'

// Cross-domain: the schedules ↔ channels outbox consumer (§9). Consumer
// function + payload shape only — the generic outbox relay is wired by the
// schedules build (OQ-5 / D19).
export {
  consumeScheduleRunCompletedEvent,
  type ScheduleRunCompletedPayload,
} from './delivery/consume-schedule-run-completed-event.js'
