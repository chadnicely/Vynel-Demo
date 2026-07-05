// Public surface of the `@vynel/chat` package — the turn-consumption +
// persistence layer. Consumers import from `@vynel/chat`. The workspace and
// global-root turn RUNNERS live in `@vynel/session`; they drive
// `consumeSessionEventStream` from here to persist a turn's messages.

// Shared types + outbox event constants.
export type { StructuralLogger } from './chat-types.js'
export type {
  ChatSession,
  NewChatSession,
  ChatMessage,
  NewChatMessage,
  ChatMessageRole,
  AttachedImageMetadata,
  ChatToolCall,
  NewChatToolCall,
  ToolCallStatus,
  ApprovalStatus,
} from './chat-types.js'
export type { ChatTurnEvent } from './chat-turn-event.js'
export {
  CHAT_SESSION_CREATED,
  CHAT_SESSION_ARCHIVED,
  CHAT_SESSION_SOFT_DELETED,
  CHAT_SESSION_HARD_DELETED,
} from './chat-events.js'
export type {
  ChatSessionCreatedPayload,
  ChatSessionArchivedPayload,
  ChatSessionSoftDeletedPayload,
  ChatSessionHardDeletedPayload,
} from './chat-events.js'

// Turn consumption — the persistence engine the session runners drive.
export { consumeSessionEventStream } from './turn-consumption/consume-session-event-stream.js'
export type { ConsumeSessionEventStreamInput } from './turn-consumption/consume-session-event-stream.js'
export {
  readAttachedImageBytes,
  persistAttachedImages,
  imagesDirFor,
} from './turn-consumption/attached-images.js'
export type {
  AttachedImageBytes,
  ReadAttachedImageInput,
  PersistAttachedImagesInput,
} from './turn-consumption/attached-images.js'
export { generateSessionTitle } from './turn-consumption/generate-session-title.js'
export { buildNewChatSessionRow } from './turn-consumption/build-new-chat-session-row.js'
export type { BuildNewChatSessionRowInput } from './turn-consumption/build-new-chat-session-row.js'

// Records — the chat side of session-continuity swaps + delegation.
export { recordSwapSegmentSession } from './records/record-swap-segment-session.js'
export type { RecordSwapSegmentSessionInput } from './records/record-swap-segment-session.js'
export { recordLeafSession } from './records/record-leaf-session.js'
export type { RecordLeafSessionInput } from './records/record-leaf-session.js'
export { recordDelegatedRootMessages } from './records/record-delegated-root-messages.js'
export type { RecordDelegatedRootMessagesInput } from './records/record-delegated-root-messages.js'
export { recordPushedReportMessage } from './records/record-pushed-report-message.js'
export type { RecordPushedReportMessageInput } from './records/record-pushed-report-message.js'
export { composeManagerSourceLabel } from './records/compose-manager-source-label.js'

// History — session-list + detail CRUD.
export { listChatSessionsForWorkspace } from './history/list-chat-sessions-for-workspace.js'
export type { ListChatSessionsForWorkspaceInput } from './history/list-chat-sessions-for-workspace.js'

// Queries — cross-scope reads that don't fit the per-workspace history ops.
export { listRecentChatSessionsForUser } from './queries/list-recent-chat-sessions-for-user.js'
export type { ListRecentChatSessionsForUserInput } from './queries/list-recent-chat-sessions-for-user.js'
export { getChatSessionDetail } from './history/get-chat-session-detail.js'
export type { ChatSessionDetail } from './history/get-chat-session-detail.js'
export { searchChatSessions } from './history/search-chat-sessions.js'
export type { SearchChatSessionsInput, ChatMessageSearchResult } from './history/search-chat-sessions.js'
export { synchronizeChatSessionsForWorkspace } from './history/synchronize-chat-sessions-for-workspace.js'
export type { SynchronizeChatSessionsInput } from './history/synchronize-chat-sessions-for-workspace.js'
export { renameChatSession } from './history/rename-chat-session.js'
export { archiveChatSession, unarchiveChatSession } from './history/archive-chat-session.js'
export { softDeleteChatSession } from './history/soft-delete-chat-session.js'
export { interruptChatSession } from './history/interrupt-chat-session.js'
export { purgeDeletedChatSessions } from './history/purge-deleted-chat-sessions.js'
export type {
  PurgeDeletedChatSessionsInput,
  PurgeDeletedChatSessionsResult,
  PurgeDeletedChatSessionsDependencies,
} from './history/purge-deleted-chat-sessions.js'

// Context — the session's own `/context` report. An MCP-readable read surface;
// its `McpFeatureDescriptor` lands with `@vynel/session` so a post-swap session
// can recall its prior context on demand.
export { getSessionContextReport } from './context/get-session-context-report.js'
export type { GetSessionContextReportInput } from './context/get-session-context-report.js'
