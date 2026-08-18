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

export type ChatMessageRole = "user" | "assistant" | "system";

export type ToolCallStatus =
  "started" | "completed" | "failed" | "denied" | "cancelled";

export type ApprovalStatus = "approved" | "denied" | "timed-out" | "cancelled";

export interface AttachedImageMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Serialized row shape returned by `GET /workspaces/{workspaceId}/chat/sessions`. */
export interface ChatSessionResponse {
  id: string;
  userId: string;
  /** The owning workspace, or `null` for a global-root session (the brain's
   *  continuing conversation has no workspace). Matches the wire — the route's
   *  `ChatSessionSchema.workspaceId` is nullable. */
  workspaceId: string | null;
  providerId: string;
  /** The AI model the session ran with (e.g. 'claude-opus-4-8'), or `null` if
   *  not known yet. Drives the context-window denominator for the usage chip. */
  model: string | null;
  title: string;
  isArchived: boolean;
  /** Sidebar curation (Slice 2): `'listed'` shows in the curated sidebar;
   *  `'hidden'` is a recorded root-as-thread swap segment kept out of the list.
   *  The default list endpoint only returns `'listed'`, so the sidebar never
   *  sees `'hidden'` here — present for shape accuracy + the includeHidden path. */
  visibility: "listed" | "hidden";
  /** ISO-8601 string or `null` (soft-delete). */
  deletedAt: string | null;
  totalMessageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /**
   * Up to 120 chars of the most recent message body in this session,
   * for the conversation-list preview line. `null` when the session
   * has no messages yet (just opened) or when the most-recent message
   * body is empty. Added 2026-05-28 (macos-ui-redesign follow-up —
   * the previous list shape returned metadata only). Computed by the
   * repo via a correlated subquery; route passes through verbatim.
   */
  lastMessagePreview: string | null;
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 */
  lastMessageAt: string;
  /** ISO-8601 */
  updatedAt: string;
  /** Per-session composer settings (2026-08-17) — what the user CHOSE,
   *  distinct from `model` (what ran). Null = never set on this session.
   *  The composer reads these through `sessions.getSettings`; present here
   *  for wire-shape accuracy on the session reads that return full rows. */
  sessionMode: "ask" | "auto" | "bypass" | null;
  selectedModel: string | null;
  thinkingEffort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  autoBuildout: boolean | null;
}

/** The run that PRODUCED a delivered colleague message — resolved at serve
 *  time from the chain's work hop + its message trace. Also the shape of the
 *  client-side per-TURN aggregate (the info door on ordinary turns). */
export interface DeliveredRunStatsResponse {
  /** The model the run used (the job's override, else the session's); null unknown. */
  model: string | null;
  toolCallCount: number;
  /** FRESH input this run/turn added to the context — the occupancy delta
   *  against the session's context before it (a row's stored inputTokens is
   *  the request's WHOLE window, never a per-message cost). Null when the
   *  delta can't be derived (no usage, or occupancy shrank across a
   *  compaction swap). */
  inputTokens: number | null;
  outputTokens: number | null;
  /** The context-window occupancy after the run/turn — the same number the
   *  composer ring tracks. */
  contextTokens: number | null;
  /** Claim → report/completion; null while the producing run is still going. */
  durationMs: number | null;
}

/** Serialized row shape inside `GET /sessions/{id}` (within the `messages` array). */
export interface ChatMessageResponse {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  /** Brain-tree source identity (null/absent for ordinary workspace chat). A task
   *  delegated IN from the global brain is `role:'user'` + `sourceKind:'global-root'`;
   *  a bubbled-up report is `role:'assistant'` + `sourceKind:'workspace-manager'|'agent'`
   *  with `sourceLabel` = the workspace/agent name. */
  sourceKind?: "user" | "global-root" | "workspace-manager" | "agent" | "system" | null;
  sourceLabel?: string | null;
  /** The inbound channel a USER row arrived through ('voice'/'telegram'/'discord');
   *  null/absent = the app composer (no badge). Distinct from sourceKind: origin is
   *  HOW the message reached the brain, not who wrote it. */
  originChannel?: "voice" | "telegram" | "discord" | "zoom" | null;
  /** Brain-tree delegation correlation key (Ch3) — present on a bubbled-up report row so
   *  the surface can open its condensed trace; null/absent on ordinary rows. */
  partialSessionId?: string | null;
  /** The delegation CHAIN key (persona-sessions) — per-task, carried across every hop
   *  where partialSessionId is per-hop. The live card's settle-match key. */
  threadId?: string | null;
  /** The delegated task as a short label ("Set up the login page") — enriched at serve
   *  time from the job the `partialSessionId` names, so the Watch chip can say what the
   *  work IS. Absent on ordinary rows and when the job is gone. */
  delegationTaskLabel?: string | null;
  /** Serve-time enrichment on a DELIVERED colleague row (report/update/message):
   *  the PRODUCING run's stats — the info-icon hover card beside the author
   *  line. Absent on ordinary rows and unenriched routes. */
  runStats?: DeliveredRunStatsResponse | null;
  body: string;
  thinkingBody: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attachedImagesMetadata: AttachedImageMetadata[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 or `null` (still streaming). */
  completedAt: string | null;
  /** ISO-8601 */
  createdAt: string;
}

/** One tool call a SUBAGENT made, persisted lean (no output) on its spawning
 *  Agent call's row — the settled source for the nested activity pane. */
export interface SubagentToolCallResponse {
  toolUseId: string;
  toolName: string;
  toolInput?: unknown;
  status: "started" | "completed" | "failed";
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 or `null` (never completed — the run was interrupted). */
  completedAt: string | null;
}

/** Serve-time enrichment on a session-comms dispatch call: the delegation job
 *  it enqueued. The thread's PERSISTENT door to that delegation — unlike the
 *  processing banner (in-flight only), it survives settlement so the history
 *  stays readable on the message that sent the task. PIPELINE SCOPING (Chad,
 *  locked 2026-07-27): this is the DIRECT hop only — a surface watches one
 *  level down; deeper hops surface inside the opened watch, never flattened
 *  into an ancestor thread. */
export interface DelegationToolOutcomeResponse {
  jobId: string;
  /** The trace key the activity monitor opens; null on rows enqueued before tracing. */
  partialSessionId: string | null;
  status: "pending" | "claimed" | "completed" | "failed";
  /** Where the message went, as the dispatch route answered ("vynel", "Global"). */
  deliveredTo: string | null;
  /** Short label of the delegated task; null for a report delivery (its text is a report). */
  taskLabel: string | null;
  /** ISO-8601 — when the child reported back via the tool; null otherwise. */
  reportedAt: string | null;
  /** ISO-8601 — when the job settled; null while in flight. */
  completedAt: string | null;
  /** The target workspace (workspace-target tasks) — the settled pointer's
   *  sidebar destination once the in-flight poll no longer carries the job. */
  workspaceId: string | null;
  /** The target's CURRENT segment id (session-target tasks), resolved at
   *  serve time — the settled pointer opens the conversation by it. */
  targetSessionId: string | null;
}

/** Serialized row shape inside `GET /sessions/{id}` (within `toolCallsByMessageId` values). */
export interface ChatToolCallResponse {
  id: string;
  parentMessageId: string;
  toolUseId: string;
  toolName: string;
  /** `z.unknown()` on the wire infers an optional key — present with any value
   *  (including null) in practice; presenters narrow it. */
  toolInput?: unknown;
  toolOutput?: unknown;
  status: ToolCallStatus;
  approvalStatus: ApprovalStatus | null;
  isErrorResult: boolean;
  /** A spawning Agent/Task call's persisted subagent narrative — null (or
   *  absent, on older payload producers) on ordinary calls. */
  subagentNarrative?: string | null;
  /** The subagent's persisted tool calls; null/absent on ordinary calls. */
  subagentToolCalls?: SubagentToolCallResponse[] | null;
  /** Present on a session-comms dispatch call (send_message / send_task_*):
   *  the enqueued delegation, attached at detail-serve time (absent on
   *  live-streamed rows — the processing banner covers the live window). */
  delegation?: DelegationToolOutcomeResponse | null;
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 or `null` (still running). */
  completedAt: string | null;
}

/** Full detail payload returned by `GET /sessions/{id}`. */
export interface ChatSessionDetailResponse {
  session: ChatSessionResponse;
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
}

/** Response of `GET /sessions/{id}/context` — the runtime's `/context`
 *  breakdown as raw markdown, or `null` if the provider exposes no `/context`
 *  command or the read failed (the UI falls back to the lightweight popover). */
export interface ChatContextReportResponse {
  report: string | null;
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
  rootSessionId: string | null;
  currentSdkSessionId: string | null;
  /** When the conversation last spoke — null until it has. Talking counts as
   *  working: a room that chatted without ever planning steps still has to read
   *  as running, and the step dock alone would call it idle. */
  lastMessageAt: string | null;
}

/** Each row returned by `GET /sessions/search`. */
export interface ChatMessageSearchResultResponse {
  messageId: string;
  sessionId: string;
  /** Body with `<mark>...</mark>` highlight markers around match runs. */
  snippet: string;
  /** FTS5 rank — lower is better. */
  rank: number;
}

/**
 * SSE turn-event union sent by `POST /sessions/turn`. Same kinds as
 * `packages/core/src/chat/chat-turn-event.ts`'s `ChatTurnEvent` but with
 * Date fields serialized to ISO strings (the wire shape).
 */
export type ChatTurnEvent =
  | { kind: "user-message-persisted"; message: ChatMessageResponse }
  | { kind: "session-created"; session: ChatSessionResponse }
  | { kind: "session-titled"; sessionId: string; title: string }
  | { kind: "text-chunk"; messageId: string; textDelta: string }
  | { kind: "thinking-chunk"; messageId: string; thinkingDelta: string }
  | { kind: "tool-call-started"; toolCall: ChatToolCallResponse }
  | { kind: "tool-call-completed"; toolCall: ChatToolCallResponse }
  // A SUBAGENT's live activity, keyed by the spawning Agent tool call's
  // toolUseId — nested under the card while the turn streams, never in the
  // main transcript. The same activity persists on the Agent call's row
  // (subagentNarrative/subagentToolCalls), so settled reads carry it too.
  | { kind: "agent-text-chunk"; parentToolUseId: string; textDelta: string }
  | {
      kind: "agent-tool-started";
      parentToolUseId: string;
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
      /** ISO-8601 */
      startedAt: string;
    }
  | {
      kind: "agent-tool-completed";
      parentToolUseId: string;
      toolUseId: string;
      /** The tool that completed — carried so a consumer can act on the frame
       *  without having tracked the matching `agent-tool-started` (the desktop
       *  overlay settles its steps from this). Null when the start was never
       *  recorded. */
      toolName: string | null;
      toolOutput: unknown;
      isError: boolean;
      /** ISO-8601 */
      completedAt: string;
    }
  | {
      kind: "approval-requested";
      approvalRequestId: string;
      parentMessageId: string;
      toolName: string;
      toolInput: unknown;
      /** ISO-8601 */
      requestedAt: string;
    }
  | {
      kind: "approval-resolved";
      approvalRequestId: string;
      decision: unknown; // approvals domain owns the typed shape; opaque here
      /** ISO-8601 */
      resolvedAt: string;
    }
  | {
      // Emitted when chat's consumer auto-resolves an approval via a saved
      // rule. UI renders a "Auto-approved by your rule" pill instead of
      // the full ApprovalCard (approvals D10).
      kind: "approval-auto-resolved";
      approvalRequestId: string;
      parentMessageId?: string;
      matchedRuleId: string;
      /** ISO-8601 */
      resolvedAt: string;
    }
  | {
      // `inputTokens` is the uncached remainder; the cache fields carry the rest
      // of the input side. Context-window occupancy for the turn = inputTokens +
      // cacheReadInputTokens + cacheCreationInputTokens (prompt caching means
      // inputTokens alone undercounts the real context sent to the model).
      kind: "usage-reported";
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }
  | { kind: "session-completed"; sessionId: string }
  // The visible swap: the conversation is being continued on a fresh context
  // (after the turn's own events) — `context-patching` while the carry is
  // distilled + seeded, then `context-patched` naming the fresh segment
  // (`toSessionId` null = the swap aborted; the conversation stays put).
  | { kind: "context-patching"; sessionId: string; primarySessionId: string }
  | {
      kind: "context-patched";
      sessionId: string;
      primarySessionId: string;
      toSessionId: string | null;
    }
  | { kind: "session-interrupted"; sessionId: string }
  | {
      kind: "session-errored";
      sessionId: string;
      errorCode: string;
      errorMessage: string;
      isRecoverable: boolean;
    }
  | { kind: "turn-stream-ended" };
