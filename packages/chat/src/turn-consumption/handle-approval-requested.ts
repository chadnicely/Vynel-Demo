// Handler for the `approval-requested` variant of the session-event
// stream. Extracted from `consume-session-event-stream.ts` per
// structure-standard.md "File size cap" (audit 2026-05-27).
//
// Calls into the approvals domain to persist the audit row + evaluate
// rules. Yields either `approval-requested` (full card) or
// `approval-auto-resolved` (status pill) based on the rule-match
// outcome.
//
// NOTE on toolUseId (foundation-hardening backlog): the provider's
// ApprovalRequestedEvent does not carry the SDK's tool_use_id —
// Claude's canUseTool callback generates its own approvalRequestId
// separate from the SDK-assigned tool_use_id that arrives later via
// tool-use-started. We use approvalRequestId as the toolUseId
// placeholder so the audit row is valid; the JOIN onto
// chat_tool_calls.toolUseId won't match until the providers domain
// surfaces the SDK's tool_use_id via the event payload.

import type { Database } from '@vynel/db'
import type { AiAgentProviderId, NormalizedSessionEvent } from '@vynel/providers'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger } from '../chat-types.js'

export type HandleApprovalRequestedInput = {
  db: Database
  event: Extract<NormalizedSessionEvent, { kind: 'approval-requested' }>
  sessionId: string | null
  userId: string
  /** Null for a global-root (brain) session — a workspace-less card is forwarded
   *  without persisting the workspace-scoped audit row (see the guard below). */
  workspaceId: string | null
  providerId: AiAgentProviderId
  logger: StructuralLogger | undefined
}

export async function handleApprovalRequested(
  input: HandleApprovalRequestedInput,
): Promise<ChatTurnEvent> {
  const { db, event, sessionId, userId, workspaceId, providerId, logger } = input

  // Forward the card WITHOUT persisting the workspace-scoped audit row when there's
  // no session row yet, OR when this is a workspace-less global-root (brain) session.
  // The brain only cards when desktop act is enabled (rare); full brain-approval
  // persistence is deferred with the desktop-act-for-brain work. Non-regressive —
  // the brain never persisted approvals before the session unification either.
  if (!sessionId || workspaceId === null) {
    logger?.warn(
      { approvalRequestId: event.approvalRequestId, sessionId, hasWorkspace: workspaceId !== null },
      'approval-requested forwarded without persistence (no session row yet, or a global-root session)',
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
      toolUseId: event.approvalRequestId, // PLACEHOLDER — foundation-hardening
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
