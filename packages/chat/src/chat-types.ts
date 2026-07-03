// Domain-only types for the `chat` core layer. See
// `docs/blueprints/chat/coding.md §3` + blueprint §5.1.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer). Row types (ChatSession,
// ChatMessage, ChatToolCall) are re-exported from `@vynel/db` for
// consumer convenience.

import type { ChatSessionVisibility } from './repositories/index.js'

export type { StructuralLogger } from '@vynel/logger'

export type {
  ChatSession,
  NewChatSession,
  ChatMessage,
  NewChatMessage,
  ChatMessageRole,
  ChatMessageSourceKind,
  ChatSessionVisibility,
  AttachedImageMetadata,
  ChatToolCall,
  NewChatToolCall,
  ToolCallStatus,
  ApprovalStatus,
} from './repositories/index.js'

/**
 * Presentation overrides for a freshly-created session row, threaded through
 * `consumeSessionEventStream` → `handleSessionStarted`. The workspace path omits
 * them (defaults: `'listed'`, the placeholder title, auto-titled); the global-root
 * (brain) passes `{ visibility: 'hidden', title: 'Global brain', skipAutoTitle: true }`
 * so its segments stay out of the curated sidebar and keep their fixed title.
 */
export type NewSessionOptions = {
  visibility?: ChatSessionVisibility
  title?: string
  /** Skip `generateSessionTitle` on session-completed (the brain keeps its fixed title). */
  skipAutoTitle?: boolean
}
