// Outbox event type constants + payload interfaces for the `chat` domain.
// Per D20: four lifecycle events only (no per-message or per-tool-call
// events — volume cost outweighs value; downstream consumers needing
// granular hooks subscribe to the SSE stream directly).
//
// Each event row is co-committed in the same transaction as the state change
// (per the outbox infra workspaces shipped — `_shared/outbox-events` table +
// `_shared/outbox` repo).
//
// Consumers downstream of chat (memory, knowledge, channels) cast the
// outbox row's payload to the typed shape below per the workspaces D14
// precedent.
//
// See `docs/blueprints/chat/blueprint.md §10.2` + `decisions.md` D20.

export const CHAT_SESSION_CREATED = 'chat.session-created' as const
export const CHAT_SESSION_ARCHIVED = 'chat.session-archived' as const
export const CHAT_SESSION_SOFT_DELETED = 'chat.session-soft-deleted' as const
export const CHAT_SESSION_HARD_DELETED = 'chat.session-hard-deleted' as const
// The assistant set the conversation's status light (Move 3, 2026-08-17) —
// the WORKSPACE_STATUS_SET_EVENT sibling, per session.
export const CHAT_SESSION_STATUS_SET = 'chat.session-status-set' as const

export type ChatSessionCreatedPayload = {
  userId: string
  // Nullable for the GLOBAL root's recorded segment (agent-base Slice 3b) — it has
  // no workspace. Non-null for every workspace session. Consumers narrow per row.
  workspaceId: string | null
  sessionId: string
  providerId: string
}

export type ChatSessionArchivedPayload = {
  userId: string
  workspaceId: string
  sessionId: string
}

export type ChatSessionSoftDeletedPayload = {
  userId: string
  workspaceId: string
  sessionId: string
}

export type ChatSessionHardDeletedPayload = {
  userId: string
  workspaceId: string
  sessionId: string
}

export type ChatSessionStatusSetPayload = {
  userId: string
  workspaceId: string | null
  sessionId: string
  status: 'completed' | 'problem' | 'needs_input'
  note: string | null
  setAt: string
}
