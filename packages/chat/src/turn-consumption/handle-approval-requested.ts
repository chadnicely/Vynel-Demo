// Handler for the `approval-requested` variant of the session-event
// stream. Extracted from `consume-session-event-stream.ts` per
// structure-standard.md "File size cap" (audit 2026-05-27).
//
// Calls into the approvals domain to persist the audit row + evaluate
// rules. Yields either `approval-requested` (full card) or
// `approval-auto-resolved` (status pill) based on the rule-match
// outcome.
//
// toolUseId: the provider surfaces the SDK's tool_use_id on the event
// (canUseTool's `toolUseID`, SDK ≥0.3.213), so the audit row JOINs onto
// chat_tool_calls.toolUseId for real. The approvalRequestId fallback
// keeps the NOT-NULL column valid for a provider sibling without
// per-call ids (the original placeholder behavior).

import type { Database } from '@vynel/db'
import type { AiAgentProviderId, NormalizedSessionEvent } from '@vynel/providers'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger } from '../chat-types.js'

export type HandleApprovalRequestedInput = {
  db: Database
  event: Extract<NormalizedSessionEvent, { kind: 'approval-requested' }>
  sessionId: string | null
  userId: string
  /** Null for a global-root (brain) session — the card persists with a null
   *  workspaceId (the column is nullable) so it reaches the user's global queue. */
  workspaceId: string | null
  providerId: AiAgentProviderId
  logger: StructuralLogger | undefined
}

export async function handleApprovalRequested(
  input: HandleApprovalRequestedInput,
): Promise<ChatTurnEvent> {
  const { db, event, sessionId, userId, workspaceId, providerId, logger } = input

  // Forward the card WITHOUT persisting ONLY when there's no session row yet (the
  // FK-less `sessionId` audit column is NOT NULL — a card can briefly arrive before
  // session-started). A workspace-less global-root (brain) card DOES persist now
  // (`approval_requests.workspaceId` is nullable), so it surfaces in the user's
  // global approval queue instead of being lost to the stream — the stuck-card fix.
  if (!sessionId) {
    logger?.warn(
      { approvalRequestId: event.approvalRequestId },
      'approval-requested forwarded without persistence (no session row yet)',
    )
    return {
      kind: 'approval-requested',
      approvalRequestId: event.approvalRequestId,
      parentMessageId: event.parentMessageId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      requestedAt: event.requestedAt,
    }
  }

  // Lazy import: keep `@vynel/approvals` off chat's static import graph. The
  // recording is synchronous here because the turn stream needs the approval id
  // to emit its `approval-requested` event. NOTE (deferred): this chat -> approvals
  // cross-feature edge is a candidate to decouple (outbox / session-layer) — see
  // `docs/module-notes/chat.md`.
  const { recordApprovalRequest } = await import('@vynel/approvals')
  const result = await recordApprovalRequest(
    db,
    {
      providerApprovalId: event.approvalRequestId,
      userId,
      workspaceId,
      sessionId,
      parentMessageId: event.parentMessageId,
      toolUseId: event.toolUseId ?? event.approvalRequestId,
      providerId,
      toolName: event.toolName,
      toolInput: event.toolInput,
    },
    ...(logger ? [{ logger }] : []),
  )

  if (result.kind === 'auto-approved') {
    return {
      kind: 'approval-auto-resolved',
      approvalRequestId: event.approvalRequestId,
      parentMessageId: event.parentMessageId,
      matchedRuleId: result.matchedRuleId,
      resolvedAt: result.request.resolvedAt ?? new Date(),
    }
  }
  return {
    kind: 'approval-requested',
    approvalRequestId: event.approvalRequestId,
    parentMessageId: event.parentMessageId,
    toolName: event.toolName,
    toolInput: event.toolInput,
    requestedAt: event.requestedAt,
  }
}
