// Core op — resolve a pending approval at the user's direction (HTTP
// decide route or channel-relay forward). Throws NotFoundError when the
// request doesn't exist OR is owned by another user/workspace (no
// enumeration leak — workspaces D14 precedent). Throws ConflictError
// when the request is already resolved.
//
// Ordering invariant: provider call BEFORE row update.
// If the provider call fails (session interrupted, request id unknown),
// the row stays pending; the `recoverStalePendingApprovals` worker
// eventually resolves it as timed-out. The inverse failure mode (row
// updated but provider unblock failed) would leave the agent waiting
// forever — strictly worse.

import { randomUUID } from 'node:crypto'
import { resolveAiAgentProvider } from '@vynel/providers'
import * as approvalRequestsRepository from './repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { APPROVAL_USER_RESOLVED, type ApprovalResolvedPayload } from './approvals-events.js'
import {
  saveApprovalRuleFromDecision,
  type RememberRuleInput,
} from './save-approval-rule-from-decision.js'
import type { ApprovalRequest, StructuralLogger } from './approvals-types.js'
import { withTransaction, type Database } from '@vynel/db'
import type { AiAgentProviderId, ApprovalDecision } from '@vynel/providers'

export type { RememberRuleInput } from './save-approval-rule-from-decision.js'

export type ResolveApprovalInput = {
  providerApprovalId: string
  userId: string
  workspaceId: string
  providerId: AiAgentProviderId
  decision:
    | { kind: 'approved'; updatedInput?: unknown; rememberRule?: RememberRuleInput }
    | { kind: 'denied'; reason: string }
}

export async function resolveApproval(
  db: Database,
  input: ResolveApprovalInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<ApprovalRequest> {
  const request = approvalRequestsRepository.findApprovalRequestByProviderApprovalId(
    db,
    input.providerApprovalId,
  )
  if (!request) throw new NotFoundError('approval-request', input.providerApprovalId)
  if (request.userId !== input.userId || request.workspaceId !== input.workspaceId) {
    // No enumeration: same response shape as "not found" (workspaces D14
    // precedent). Phase 1 has one user so the leak is theoretical; the
    // pattern locks in for Phase 2.
    throw new NotFoundError('approval-request', input.providerApprovalId)
  }
  if (request.status === 'resolved') {
    throw new ConflictError(`Approval ${input.providerApprovalId} has already been resolved.`)
  }

  // 1. Call the provider (async, OUTSIDE the tx) — unblocks the agent.
  //    If this throws, the row stays pending; recovery worker reaps it.
  const provider = resolveAiAgentProvider(input.providerId)
  const providerPayload = buildProviderPayload(input.decision)
  await provider.respondToApprovalRequest(input.providerApprovalId, providerPayload)

  // 2. Update row + (optionally) save the rule + emit outbox event (sync tx).
  const resolvedAt = new Date()
  return withTransaction(db, (tx) => {
    const patch: Parameters<typeof approvalRequestsRepository.updateApprovalRequest>[2] = {
      status: 'resolved',
      resolutionKind: input.decision.kind,
      resolutionReason: input.decision.kind === 'denied' ? input.decision.reason : null,
      resolvedAt,
    }
    if (input.decision.kind === 'approved' && input.decision.updatedInput !== undefined) {
      patch.resolutionUpdatedInput = input.decision.updatedInput
    } else {
      patch.resolutionUpdatedInput = null
    }
    const updated = approvalRequestsRepository.updateApprovalRequest(tx, request.id, patch)

    if (input.decision.kind === 'approved' && input.decision.rememberRule) {
      saveApprovalRuleFromDecision(tx, {
        userId: request.userId,
        workspaceId: request.workspaceId,
        sourceRequest: updated,
        rememberRule: input.decision.rememberRule,
      })
    }

    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APPROVAL_USER_RESOLVED,
      payload: {
        userId: updated.userId,
        workspaceId: updated.workspaceId,
        sessionId: updated.sessionId,
        parentMessageId: updated.parentMessageId,
        toolUseId: updated.toolUseId,
        approvalRequestId: updated.id,
        providerApprovalId: updated.providerApprovalId,
        resolutionKind: updated.resolutionKind!,
        autoApprovedByRuleId: null,
        resolvedAt,
      } satisfies ApprovalResolvedPayload,
      createdAt: resolvedAt,
      processedAt: null,
    })

    deps.logger?.info(
      { providerApprovalId: input.providerApprovalId, decisionKind: input.decision.kind },
      'approval resolved by user',
    )
    return updated
  })
}

function buildProviderPayload(decision: ResolveApprovalInput['decision']): ApprovalDecision {
  if (decision.kind === 'approved') {
    const payload: { kind: 'approved'; updatedInput?: unknown } = { kind: 'approved' }
    if (decision.updatedInput !== undefined) {
      payload.updatedInput = decision.updatedInput
    }
    // rememberRule on ApprovalDecision is `string | undefined` per
    // providers' shared/approval-decision.ts — Vynel handles the rule
    // itself; the provider sees no rule (it doesn't need to).
    return payload
  }
  return { kind: 'denied', reason: decision.reason }
}
