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
}

/** A streamed delta of assistant extended-thinking text. */
export type ThinkingChunkEvent = {
  kind: 'thinking-chunk'
  sessionId: string
  messageId: string
  textDelta: string
  isFinalChunk: boolean
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
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UsageReportedEvent
  | SessionCompletedEvent
  | SessionInterruptedEvent
  | SessionErroredEvent
