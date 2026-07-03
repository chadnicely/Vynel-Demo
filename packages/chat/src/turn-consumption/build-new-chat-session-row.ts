// Single source of truth for the shape of a freshly-inserted `chat_sessions`
// row. Two callers create new session rows and they MUST stay in lockstep —
// the normal first-turn insert (`handle-session-started.ts`, new-session
// branch) and the swap-segment insert (`record-swap-segment-session.ts`, the
// root-as-thread continuity layer). A hand-rolled second insert would drift on
// the next column add (model, a counter, an index-backed flag), so both go
// through here. Spec: `.claude/docs/agent-base/root-session-architecture.md §2`
// (recorded segments share the chat-session shape).

import type { NewChatSession, ChatSessionVisibility, ChatSessionScope } from '../repositories/index.js'
import type { AiAgentProviderId } from '@vynel/providers'

export type BuildNewChatSessionRowInput = {
  /** The SDK-assigned session id — the row PK (D15: `chat_sessions.id` = SDK id). */
  sessionId: string
  userId: string
  /** Nullable for the GLOBAL root's recorded segments (Slice 3b); non-null otherwise. */
  workspaceId: string | null
  providerId: AiAgentProviderId
  /** Session start instant — also seeds `lastMessageAt` + `updatedAt`. */
  startedAt: Date
  /** Display title. Defaults to the first-turn placeholder. */
  title?: string
  /** Messages already attributed to the session at insert time (the co-committed
   *  user message on a normal first turn = 1; a swap segment starts empty = 0). */
  initialMessageCount?: number
  /** Sidebar curation (Slice 2). Defaults to `'listed'` (a normal conversation);
   *  swap segments pass `'hidden'`. */
  visibility?: ChatSessionVisibility
  /** The explicit session-type discriminator. Defaults to derivation from
   *  `workspaceId` (`null → 'global'`, else `'workspace'`); a leaf/agent session
   *  passes `'agent'` explicitly (it runs in a workspace but is not the user's
   *  workspace conversation). */
  scope?: ChatSessionScope
}

const DEFAULT_SESSION_TITLE = 'New session'

export function buildNewChatSessionRow(input: BuildNewChatSessionRowInput): NewChatSession {
  const { startedAt } = input
  return {
    id: input.sessionId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    providerId: input.providerId,
    title: input.title ?? DEFAULT_SESSION_TITLE,
    visibility: input.visibility ?? 'listed',
    scope: input.scope ?? (input.workspaceId === null ? 'global' : 'workspace'),
    isArchived: false,
    deletedAt: null,
    totalMessageCount: input.initialMessageCount ?? 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt,
    lastMessageAt: startedAt,
    updatedAt: startedAt,
  }
}
