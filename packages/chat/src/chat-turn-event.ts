// `ChatTurnEvent` — the UI-bound event union the SSE stream emits per turn.
// Every `NormalizedSessionEvent` variant the providers SDK emits has a
// corresponding `ChatTurnEvent` mapping (see blueprint §6 translation table).
//
// Discriminated union on `kind` per `coding-guideline.md §3` Stripe
// convention. Pick one discriminator and stay consistent.
//
// Filled out by `/build-domain chat` (blueprint §14 step 7). The shape below
// is the locked spec from blueprint §5.4.

import type { ChatSession, ChatMessage, ChatToolCall } from './repositories/index.js'
import type { ApprovalDecision } from '@vynel/providers'

export type ChatTurnEvent =
  | { kind: 'user-message-persisted'; message: ChatMessage }
  | { kind: 'session-created'; session: ChatSession }
  | { kind: 'session-titled'; sessionId: string; title: string }
  | { kind: 'text-chunk'; messageId: string; textDelta: string }
  | { kind: 'thinking-chunk'; messageId: string; thinkingDelta: string }
  | { kind: 'tool-call-started'; toolCall: ChatToolCall }
  | { kind: 'tool-call-completed'; toolCall: ChatToolCall }
  // A SUBAGENT's live activity, keyed by the spawning Agent tool call's
  // toolUseId. LIVE-ONLY by design: nothing persists (the Agent card's settled
  // toolOutput carries the final report) — the UI nests these under the card
  // while the turn streams, never in the main transcript.
  | { kind: 'agent-text-chunk'; parentToolUseId: string; textDelta: string }
  | {
      kind: 'agent-tool-started'
      parentToolUseId: string
      toolUseId: string
      toolName: string
      toolInput: unknown
      startedAt: Date
    }
  | {
      kind: 'agent-tool-completed'
      parentToolUseId: string
      toolUseId: string
      toolOutput: unknown
      isError: boolean
      completedAt: Date
    }
  | {
      kind: 'approval-requested'
      approvalRequestId: string
      parentMessageId: string
      toolName: string
      toolInput: unknown
      requestedAt: Date
    }
  | {
      kind: 'approval-resolved'
      approvalRequestId: string
      decision: ApprovalDecision
      resolvedAt: Date
    }
  | {
      // Emitted when chat's consumer auto-resolves an approval via a saved
      // rule. The UI renders a small "Auto-approved by your rule" pill
      // anchored at parentMessageId (mirroring where the full card would
      // have appeared) instead of an interactive approval card (D10).
      kind: 'approval-auto-resolved'
      approvalRequestId: string
      parentMessageId: string
      matchedRuleId: string
      resolvedAt: Date
    }
  | {
      // `inputTokens` is the uncached remainder the SDK bills; the cache fields
      // carry the rest of the input side. Real context-window occupancy for the
      // turn = inputTokens + cacheReadInputTokens + cacheCreationInputTokens (the
      // Agent SDK caches heavily, so inputTokens alone badly undercounts).
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
