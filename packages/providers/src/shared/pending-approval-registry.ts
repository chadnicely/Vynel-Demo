// `PendingApprovalRegistry` — the in-memory map of tool-approvals awaiting a
// decision. Its `resolve` callback is the lever that lets
// `respondToApprovalRequest` resume the SDK's awaiting promise from outside
// the `canUseTool` callback. See `docs/blueprints/providers/blueprint.md §10`.
//
// In-memory only — state does NOT survive a process restart. The Phase 1
// restart mitigation (surface-on-resume) lives in blueprint §19.

import type { ApprovalDecision } from './approval-decision.js'

export type PendingApprovalRecord = {
  approvalRequestId: string
  sessionId: string
  toolName: string
  toolInput: unknown
  requestedAt: Date
  /** Resolved when the user (or a timeout) decides. */
  resolve: (decision: ApprovalDecision) => void
}

export class PendingApprovalRegistry {
  private readonly pendingApprovalsByApprovalRequestId = new Map<string, PendingApprovalRecord>()

  register(record: PendingApprovalRecord): void {
    this.pendingApprovalsByApprovalRequestId.set(record.approvalRequestId, record)
  }

  has(approvalRequestId: string): boolean {
    return this.pendingApprovalsByApprovalRequestId.has(approvalRequestId)
  }

  resolve(approvalRequestId: string, decision: ApprovalDecision): boolean {
    const record = this.pendingApprovalsByApprovalRequestId.get(approvalRequestId)
    if (!record) {
      return false
    }
    record.resolve(decision)
    this.pendingApprovalsByApprovalRequestId.delete(approvalRequestId)
    return true
  }

  listPendingForSession(sessionId: string): PendingApprovalRecord[] {
    return Array.from(this.pendingApprovalsByApprovalRequestId.values()).filter(
      (record) => record.sessionId === sessionId,
    )
  }

  /** Cancels every pending approval for a session — called when the session
   *  is interrupted or otherwise ends. Resolves each with `kind: 'cancelled'`. */
  cancelAllForSession(sessionId: string): void {
    for (const [requestId, record] of this.pendingApprovalsByApprovalRequestId.entries()) {
      if (record.sessionId === sessionId) {
        record.resolve({ kind: 'cancelled' })
        this.pendingApprovalsByApprovalRequestId.delete(requestId)
      }
    }
  }
}
