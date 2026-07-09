// HTTP shapes for the `chat` domain. The serialized JSON shapes
// `apps/local-api/src/routes/chat/index.ts` returns + the SSE event shape
// `streamSSE` writes. `apps/web` casts SDK responses to these (the
// chat routes carry no response schema in the OpenAPI spec — letterman's
// cast-via-contracts pattern, locked at `apps-web-foundation-design`).
//
// Promoted to `@vynel/contracts/chat` on the `apps/web` second-consumer
// trigger per `coding-standard.md` "Zod schemas" + the workspaces /
// identity-files precedent. Note: blueprint §14 step 5's "do NOT promote
// to @vynel/contracts/chat" only blocked `chat-events.ts` (the outbox
// event constants — no apps/web consumer in Phase 1). The HTTP row +
// turn-event types are different concerns.
//
// `ChatMessageRole` / `ToolCallStatus` / `ApprovalStatus` /
// `AttachedImageMetadata` mirror the schema-file definitions in
// `@vynel/chat`'s `src/schema/*.ts` (the workspaces `WorkspaceKind` precedent —
// parallel sources of truth kept in sync by discipline; `@vynel/contracts`
// is dependency-free other than zod).

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ToolCallStatus = 'started' | 'completed' | 'failed' | 'denied' | 'cancelled'

export type ApprovalStatus = 'approved' | 'denied' | 'timed-out' | 'cancelled'

export interface AttachedImageMetadata {
  filename: string
  mimeType: string
  sizeBytes: number
}

/** Serialized row shape returned by `GET /workspaces/{workspaceId}/chat/sessions`. */
export interface ChatSessionResponse {
  id: string
  userId: string
  /** The owning workspace, or `null` for a global-root session (the brain's
   *  continuing conversation has no workspace). Matches the wire — the route's
   *  `ChatSessionSchema.workspaceId` is nullable. */
  workspaceId: string | null
  providerId: string
  /** The AI model the session ran with (e.g. 'claude-opus-4-8'), or `null` if
   *  not known yet. Drives the context-window denominator for the usage chip. */
  model: string | null
  title: string
  isArchived: boolean
  /** Sidebar curation (Slice 2): `'listed'` shows in the curated sidebar;
   *  `'hidden'` is a recorded root-as-thread swap segment kept out of the list.
   *  The default list endpoint only returns `'listed'`, so the sidebar never
   *  sees `'hidden'` here — present for shape accuracy + the includeHidden path. */
  visibility: 'listed' | 'hidden'
  /** ISO-8601 string or `null` (soft-delete). */
  deletedAt: string | null
  totalMessageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  /**
   * Up to 120 chars of the most recent message body in this session,
   * for the conversation-list preview line. `null` when the session
   * has no messages yet (just opened) or when the most-recent message
   * body is empty. Added 2026-05-28 (macos-ui-redesign follow-up —
   * the previous list shape returned metadata only). Computed by the
   * repo via a correlated subquery; route passes through verbatim.
   */
  lastMessagePreview: string | null
  /** ISO-8601 */
  startedAt: string
  /** ISO-8601 */
  lastMessageAt: string
  /** ISO-8601 */
  updatedAt: string
}

/** Serialized row shape inside `GET /sessions/{id}` (within the `messages` array). */
export interface ChatMessageResponse {
  id: string
  sessionId: string
  role: ChatMessageRole
  /** Brain-tree source identity (null/absent for ordinary workspace chat). A task
   *  delegated IN from the global brain is `role:'user'` + `sourceKind:'global-root'`;
   *  a bubbled-up report is `role:'assistant'` + `sourceKind:'workspace-manager'|'agent'`
   *  with `sourceLabel` = the workspace/agent name. */
  sourceKind?: 'user' | 'global-root' | 'workspace-manager' | 'agent' | null
  sourceLabel?: string | null
  /** The inbound channel a USER row arrived through ('voice'/'telegram'/'discord');
   *  null/absent = the app composer (no badge). Distinct from sourceKind: origin is
   *  HOW the message reached the brain, not who wrote it. */
  originChannel?: 'voice' | 'telegram' | 'discord' | null
  /** Brain-tree delegation correlation key (Ch3) — present on a bubbled-up report row so
   *  the surface can open its condensed trace; null/absent on ordinary rows. */
  partialSessionId?: string | null
  body: string
  thinkingBody: string | null
  inputTokens: number | null
  outputTokens: number | null
  attachedImagesMetadata: AttachedImageMetadata[] | null
  errorCode: string | null
  errorMessage: string | null
  /** ISO-8601 */
  startedAt: string
  /** ISO-8601 or `null` (still streaming). */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
}

/** Serialized row shape inside `GET /sessions/{id}` (within `toolCallsByMessageId` values). */
export interface ChatToolCallResponse {
  id: string
  parentMessageId: string
  toolUseId: string
  toolName: string
  /** `z.unknown()` on the wire infers an optional key — present with any value
   *  (including null) in practice; presenters narrow it. */
  toolInput?: unknown
  toolOutput?: unknown
  status: ToolCallStatus
  approvalStatus: ApprovalStatus | null
  isErrorResult: boolean
  /** ISO-8601 */
  startedAt: string
  /** ISO-8601 or `null` (still running). */
  completedAt: string | null
}

/** Full detail payload returned by `GET /sessions/{id}`. */
export interface ChatSessionDetailResponse {
  session: ChatSessionResponse
  messages: ChatMessageResponse[]
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>
}

/** Response of `GET /sessions/{id}/context` — the runtime's `/context`
 *  breakdown as raw markdown, or `null` if the provider exposes no `/context`
 *  command or the read failed (the UI falls back to the lightweight popover). */
export interface ChatContextReportResponse {
  report: string | null
}

/**
 * Response of `GET /workspaces/{workspaceId}/chat/continuing` (Slice 2) — the
 * read-only resolve of the workspace's continuing ROOT conversation, used by the
 * continue view on landing. `rootSessionId` / `currentSdkSessionId` are `null`
 * when no root exists yet (the first continue-mode turn lazily creates it);
 * otherwise `currentSdkSessionId` is the SDK session the thread is currently on
 * (load its detail to seed the thread; it stays browsable even though hidden).
 */
export interface ContinuingConversationResponse {
  rootSessionId: string | null
  currentSdkSessionId: string | null
}

/** Each row returned by `GET /sessions/search`. */
export interface ChatMessageSearchResultResponse {
  messageId: string
  sessionId: string
  /** Body with `<mark>...</mark>` highlight markers around match runs. */
  snippet: string
  /** FTS5 rank — lower is better. */
  rank: number
}

/**
 * SSE turn-event union sent by `POST /sessions/turn`. Same kinds as
 * `packages/core/src/chat/chat-turn-event.ts`'s `ChatTurnEvent` but with
 * Date fields serialized to ISO strings (the wire shape).
 */
export type ChatTurnEvent =
  | { kind: 'user-message-persisted'; message: ChatMessageResponse }
  | { kind: 'session-created'; session: ChatSessionResponse }
  | { kind: 'session-titled'; sessionId: string; title: string }
  | { kind: 'text-chunk'; messageId: string; textDelta: string }
  | { kind: 'thinking-chunk'; messageId: string; thinkingDelta: string }
  | { kind: 'tool-call-started'; toolCall: ChatToolCallResponse }
  | { kind: 'tool-call-completed'; toolCall: ChatToolCallResponse }
  | {
      kind: 'approval-requested'
      approvalRequestId: string
      parentMessageId: string
      toolName: string
      toolInput: unknown
      /** ISO-8601 */
      requestedAt: string
    }
  | {
      kind: 'approval-resolved'
      approvalRequestId: string
      decision: unknown // approvals domain owns the typed shape; opaque here
      /** ISO-8601 */
      resolvedAt: string
    }
  | {
      // Emitted when chat's consumer auto-resolves an approval via a saved
      // rule. UI renders a "Auto-approved by your rule" pill instead of
      // the full ApprovalCard (approvals D10).
      kind: 'approval-auto-resolved'
      approvalRequestId: string
      parentMessageId?: string
      matchedRuleId: string
      /** ISO-8601 */
      resolvedAt: string
    }
  | {
      // `inputTokens` is the uncached remainder; the cache fields carry the rest
      // of the input side. Context-window occupancy for the turn = inputTokens +
      // cacheReadInputTokens + cacheCreationInputTokens (prompt caching means
      // inputTokens alone undercounts the real context sent to the model).
      kind: 'usage-reported'
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
    }
  | { kind: 'session-completed'; sessionId: string }
  | { kind: 'session-interrupted'; sessionId: string }
  | {
      kind: 'session-errored'
      sessionId: string
      errorCode: string
      errorMessage: string
      isRecoverable: boolean
    }
  | { kind: 'turn-stream-ended' }
