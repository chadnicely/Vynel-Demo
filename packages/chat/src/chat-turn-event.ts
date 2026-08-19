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
  // Every terminal settle rides this one frame, the row carrying its status —
  // a provider-refused call (`tool-use-blocked`) included: the row reads
  // `status: 'blocked'` with the refusal record as its toolOutput, so no live
  // viewer needs a second kind to fold.
  | { kind: 'tool-call-completed'; toolCall: ChatToolCall }
  // A SUBAGENT's live activity, keyed by the spawning Agent tool call's
  // toolUseId. The UI nests these under the card while the turn streams —
  // never in the main transcript. The same activity persists onto the Agent
  // call's row (subagentNarrative/subagentToolCalls) so the pane survives
  // settle/reload; the settled toolOutput still carries the final report.
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
      /** The tool that completed — carried so a consumer can act on this frame
       *  without having tracked the matching start (the desktop overlay settles
       *  its steps from it). Null when the start was never recorded. */
      toolName: string | null
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
  // The visible swap (session-continuity): after the turn's own events, the
  // runtime tells every consumer the conversation is being continued on a
  // fresh context — `context-patching` while the carry is distilled + seeded
  // (the composer says "patching context", the feed narrates it), then
  // `context-patched` with the fresh segment (`toSessionId` null = the swap
  // aborted and the conversation stays on this segment). `sessionId` is the
  // segment being superseded — the one the turn ran on.
  | { kind: 'context-patching'; sessionId: string; primarySessionId: string }
  | {
      kind: 'context-patched'
      sessionId: string
      primarySessionId: string
      toSessionId: string | null
    }
  | { kind: 'session-interrupted'; sessionId: string }
  | {
      kind: 'session-errored'
      sessionId: string
      errorCode: string
      errorMessage: string
      isRecoverable: boolean
    }
