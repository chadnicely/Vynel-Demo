// Core op — record an approval request from the provider, evaluate
// workspace rules, and either return pending OR auto-approve (calling
// the provider + updating + emitting in a second tx).
//
// Called by chat's `consume-session-event-stream.ts` in the
// `case 'approval-requested':` branch. The chat consumer awaits this
// synchronously to decide whether to yield an `approval-requested`
// SSE event (full card) or `approval-auto-resolved` (status pill).
//
// Pattern: two-phase transaction with the async provider call between.
// Phase 1 SYNC tx writes inside `withTransaction(db,(tx) => { ... })` — async
// callbacks are rejected by better-sqlite3 at runtime.

import { randomUUID } from 'node:crypto'
import { resolveAiAgentProvider } from '@vynel/providers'
import * as approvalRequestsRepository from '../repositories/index.js'
import * as approvalRulesRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { withTransaction, type Database } from '@vynel/db'
import type { AiAgentProviderId } from '@vynel/providers'
import { deriveActionKind } from '../derive-action-kind.js'
import { evaluateApprovalRules } from '../rules/evaluate-approval-rules.js'
import {
  APPROVAL_REQUESTED,
  APPROVAL_AUTO_RESOLVED,
  type ApprovalRequestedPayload,
  type ApprovalResolvedPayload,
} from '../approvals-events.js'
import type { ApprovalRequest, StructuralLogger } from '../approvals-types.js'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export type RecordApprovalRequestInput = {
  providerApprovalId: string
  userId: string
  /** Null for a global-root (brain) card — it persists (nullable column) and always
   *  parks as pending (no workspace-scoped rule can match a workspace-less card). */
  workspaceId: string | null
  sessionId: string
  parentMessageId: string
  toolUseId: string
  providerId: AiAgentProviderId
  toolName: string
  toolInput: unknown
  timeoutMs?: number
}

export type RecordApprovalRequestOutput =
  | { kind: 'pending'; request: ApprovalRequest }
  | { kind: 'auto-approved'; request: ApprovalRequest; matchedRuleId: string }

export async function recordApprovalRequest(
  db: Database,
  input: RecordApprovalRequestInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<RecordApprovalRequestOutput> {
  const actionKind = deriveActionKind(input.toolName)
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = new Date()
  const requestId = randomUUID()

  // Tx 1: insert the audit row + emit `approval.requested`.
  const request = withTransaction(db, (tx) => {
    const inserted = approvalRequestsRepository.insertApprovalRequest(tx, {
      id: requestId,
      providerApprovalId: input.providerApprovalId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      parentMessageId: input.parentMessageId,
      toolUseId: input.toolUseId,
      toolName: input.toolName,
      actionKind,
      toolInput: input.toolInput,
      status: 'pending',
      resolutionKind: null,
      resolutionReason: null,
      resolutionUpdatedInput: null,
      autoApprovedByRuleId: null,
      timeoutMs,
      requestedAt: now,
      resolvedAt: null,
    })
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APPROVAL_REQUESTED,
      payload: {
        userId: inserted.userId,
        workspaceId: inserted.workspaceId,
        sessionId: inserted.sessionId,
        parentMessageId: inserted.parentMessageId,
        toolUseId: inserted.toolUseId,
        approvalRequestId: inserted.id,
        providerApprovalId: inserted.providerApprovalId,
        toolName: inserted.toolName,
        actionKind: inserted.actionKind,
        requestedAt: inserted.requestedAt,
      } satisfies ApprovalRequestedPayload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  // A global-root (brain) card has no workspace, so no workspace-scoped rule can
  // match — it always parks as pending (the user answers it from the global queue).
  if (input.workspaceId === null) {
    return { kind: 'pending', request }
  }

  // Outside tx — fetch enabled rules + evaluate (pure).
  const workspaceRules = approvalRulesRepository.listEnabledApprovalRulesForWorkspace(
    db,
    input.workspaceId,
  )
  const ruleMatch = evaluateApprovalRules({
    toolName: input.toolName,
    actionKind,
    toolInput: input.toolInput,
    workspaceRules,
  })

  if (!ruleMatch) {
    return { kind: 'pending', request }
  }

  // Auto-approve: call the provider (async, OUTSIDE the tx) then update.
  const provider = resolveAiAgentProvider(input.providerId)
  await provider.respondToApprovalRequest(input.providerApprovalId, { kind: 'approved' })

  // Tx 2: update row + emit `approval.auto-resolved`.
  const resolvedAt = new Date()
  const updated = withTransaction(db, (tx) => {
    const next = approvalRequestsRepository.updateApprovalRequest(tx, request.id, {
      status: 'resolved',
      resolutionKind: 'approved',
      autoApprovedByRuleId: ruleMatch.rule.id,
      resolvedAt,
    })
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APPROVAL_AUTO_RESOLVED,
      payload: {
        userId: next.userId,
        workspaceId: next.workspaceId,
        sessionId: next.sessionId,
        parentMessageId: next.parentMessageId,
        toolUseId: next.toolUseId,
        approvalRequestId: next.id,
        providerApprovalId: next.providerApprovalId,
        resolutionKind: 'approved',
        autoApprovedByRuleId: ruleMatch.rule.id,
        resolvedAt,
      } satisfies ApprovalResolvedPayload,
      createdAt: resolvedAt,
      processedAt: null,
    })
    return next
  })

  deps.logger?.info(
    { providerApprovalId: input.providerApprovalId, ruleId: ruleMatch.rule.id },
    'approval auto-resolved by rule',
  )

  return { kind: 'auto-approved', request: updated, matchedRuleId: ruleMatch.rule.id }
}
