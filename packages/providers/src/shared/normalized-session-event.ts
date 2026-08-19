// `NormalizedSessionEvent` — the CLOSED discriminated union of normalized
// session-stream events (discriminated on `kind`). The runtime-agnostic event
// shape every consumer reads instead of the SDK's native shape.
//
// CLOSED union (coding.md §1.2): adding a variant is a deliberate 5-edit
// commit — the union, every translator, every consumer's exhaustive switch,
// the table-driven test. Never emit a `kind` not in this union.
//
// Variant shapes: 8 are specified by `blueprint.md §11` worked examples
// (the `runClaudeChatSession` / `buildClaudeCanUseToolCallback` code) plus
// `coding.md §8.2`. Three — `ThinkingChunkEvent`, `ToolUseCompletedEvent`,
// `UsageReportedEvent` — were DERIVED at Implement step 5 (blueprint §7.1
// referenced the union but did not enumerate every variant); they follow the
// conventions of the specified 8. If step 12's SDK translator reveals the
// real SDK shapes differ, refine them via the closed-union 5-edit ritual.

import type { ApprovalDecision } from './approval-decision.js'

/** The session has begun (or resumed). The first event of every stream. */
export type SessionStartedEvent = {
  kind: 'session-started'
  sessionId: string
  resumedFromExisting: boolean
  startedAt: Date
}

/** A streamed delta of assistant answer text. */
export type TextChunkEvent = {
  kind: 'text-chunk'
  sessionId: string
  messageId: string
  textDelta: string
  isFinalChunk: boolean
  /** Set when a SUBAGENT streamed this (the spawning Agent tool call's
   *  tool_use_id, the SDK's `parent_tool_use_id`) — consumers render it under
   *  that card, never in the main transcript. Absent = the main thread. */
  parentToolUseId?: string
}

/** A streamed delta of assistant extended-thinking text. */
export type ThinkingChunkEvent = {
  kind: 'thinking-chunk'
  sessionId: string
  messageId: string
  textDelta: string
  isFinalChunk: boolean
  /** See TextChunkEvent — subagent-attributed thinking. */
  parentToolUseId?: string
}

/** The agent has started a tool call. `toolInput` is `unknown` — the SDK's
 *  shape never leaks into this contract (coding.md common mistake #9). */
export type ToolUseStartedEvent = {
  kind: 'tool-use-started'
  sessionId: string
  parentMessageId: string
  toolUseId: string
  toolName: string
  toolInput: unknown
  startedAt: Date
  /** See TextChunkEvent — a tool call made BY a subagent. */
  parentToolUseId?: string
}

/** A tool call has finished. `output` is `unknown` — opaque to this contract. */
export type ToolUseCompletedEvent = {
  kind: 'tool-use-completed'
  sessionId: string
  parentMessageId: string
  toolUseId: string
  output: unknown
  isError: boolean
  completedAt: Date
  /** See TextChunkEvent — a subagent tool call's completion. */
  parentToolUseId?: string
}

/** The provider's OWN safety check refused a tool call before it ran — Claude's
 *  auto-mode classifier, a deny rule, the mode itself. No approval card was ever
 *  shown (the refusal short-circuits ahead of `canUseTool`); the model received
 *  a canned rejection as the tool_result and stops. Distinct from an
 *  `approval-resolved` denial, where the USER refused. The tool never ran; the
 *  user may re-authorize by re-issuing the intent on the same session. */
export type ToolUseBlockedEvent = {
  kind: 'tool-use-blocked'
  sessionId: string
  toolUseId: string
  toolName: string
  /** The deciding component ('classifier' | 'rule' | 'mode' | …); null when
   *  the provider did not say. An open string — the provider's vocabulary. */
  reasonType: string | null
  /** The component's human-readable reason, sanitized for display (no
   *  terminal escapes); null when the provider gave none. */
  reason: string | null
  /** The rejection text the model received in place of a result. */
  message: string
  blockedAt: Date
  /** Set when the refused call ran inside a SUBAGENT — the provider's own id
   *  for that subagent (Claude's `agent_id`). Unlike the chunk/tool events,
   *  this advisory names NO spawning tool call, so a consumer cannot settle it
   *  onto an Agent card's entry (that entry settles off the error echo that
   *  follows) — it can only tell the block apart from a main-thread one.
   *  Absent = the main thread. */
  agentId?: string
}

/** The agent is paused awaiting a tool-approval decision. */
export type ApprovalRequestedEvent = {
  kind: 'approval-requested'
  sessionId: string
  approvalRequestId: string
  parentMessageId: string
  toolName: string
  toolInput: unknown
  requestedAt: Date
  /** The provider's tool_use id of the gated call — correlates the approval to
   *  its chat_tool_calls row (Claude supplies it via canUseTool's `toolUseID`).
   *  Optional: a provider sibling without per-call ids still conforms. */
  toolUseId?: string
}

/** A tool-approval decision arrived (consumers update the card UI).
 *  CONTRACT: a provider MUST emit exactly one of these for every
 *  `respondToApprovalRequest` on the session - the routed-leaf drain's denial
 *  breaker and the surface-up wait-gate resume both count on it (a future
 *  provider sibling must preserve this). */
export type ApprovalResolvedEvent = {
  kind: 'approval-resolved'
  sessionId: string
  approvalRequestId: string
  decision: ApprovalDecision
  resolvedAt: Date
  /** See ApprovalRequestedEvent.toolUseId — lets the consumer stamp the
   *  decision onto the tool-call row (a denial settles it 'denied'). */
  toolUseId?: string
}

/** Per-request token usage for ONE assistant message. The input side
 *  (`inputTokens + cacheReadInputTokens + cacheCreationInputTokens`) is the real
 *  context-window occupancy at that request. Emitted once per assistant message;
 *  the consumer keeps the LAST as the session's current occupancy. `messageId`
 *  ties it to its assistant message (the row to persist occupancy on). Cache
 *  fields are optional — not every message carries them. */
export type UsageReportedEvent = {
  kind: 'usage-reported'
  sessionId: string
  /** The assistant message this usage belongs to (its `message.id`). */
  messageId?: string
  /** The model that produced this response (e.g. 'claude-opus-4-8'). Constant
   *  per session; carried here since it's on every assistant message. Drives the
   *  context-window denominator. */
  model?: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

/** The session completed cleanly. The final event of a successful stream. */
export type SessionCompletedEvent = {
  kind: 'session-completed'
  sessionId: string
  isNewSession: boolean
  completedAt: Date
}

/** The session was interrupted. The final event of an interrupted stream. */
export type SessionInterruptedEvent = {
  kind: 'session-interrupted'
  sessionId: string
  interruptedAt: Date
}

/** The session errored. The final event of a failed stream. */
export type SessionErroredEvent = {
  kind: 'session-errored'
  sessionId: string
  errorCode: string
  errorMessage: string
  isRecoverable: boolean
  erroredAt: Date
}

export type NormalizedSessionEvent =
  | SessionStartedEvent
  | TextChunkEvent
  | ThinkingChunkEvent
  | ToolUseStartedEvent
  | ToolUseCompletedEvent
  | ToolUseBlockedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UsageReportedEvent
  | SessionCompletedEvent
  | SessionInterruptedEvent
  | SessionErroredEvent
