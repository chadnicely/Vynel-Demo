// `buildRoutedApprovalHandler` — the surface-up policy for a routed delegation's
// carded tools (brain-tree fork 3, BUILT). Replaces the fail-closed auto-deny:
//
//   RECORD-AND-PARK. A carded tool's approval is RECORDED (`recordApprovalRequest`,
//   scoped to the target workspace) and NOT responded to — the provider keeps the
//   agent parked on its canUseTool Promise. The web notifier's 5s poll surfaces the
//   card everywhere; a channel-origin job ALSO gets the card pushed to its origin
//   channel (✅/❌ buttons). Whichever surface decides first wins (`resolveApproval`
//   → `respondToApprovalRequest` resumes the parked turn; the loser sees "already
//   handled"). The unanswered bound is the approvals reaper (deny at timeoutMs*2).
//
// While parked, the shared `ApprovalWaitGate` suspends `routeRequest`'s wait budget
// (decision C) — the budget measures working time, not deciding time. Workspace
// approval RULES still apply: `recordApprovalRequest` may auto-approve, in which
// case the provider was already unblocked and nothing parks.
//
// Fail-closed guarantee: if recording THROWS (a DB failure), the approval is denied
// at the provider instead — a routed turn must never deadlock on a card no surface
// can see.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { NotFoundError } from '@vynel/errors'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { recordApprovalRequest } from '@vynel/approvals'
import { enqueueApprovalRequestForRecipient, type Channel } from '@vynel/channels'
import {
  ROUTED_LEAF_APPROVAL_DENY_REASON,
  type ApprovalWaitGate,
  type DrainLeafTurnOptions,
} from '@vynel/orchestration'

/** The delegation job's origin address — where the card is ALSO pushed (Ch4). */
export interface RoutedApprovalOrigin {
  channel: Channel
  externalRecipientId: string
  externalChatContextId: string
}

export interface BuildRoutedApprovalHandlerDeps {
  db: Database
  logger: Logger
  provider: Pick<AiAgentProvider, 'respondToApprovalRequest'>
  userId: string
  /** The TARGET workspace — scopes the card (and its approval rules). */
  workspaceId: string
  /** Shared with `routeRequest` — parked approvals suspend the wait budget. */
  waitGate: ApprovalWaitGate
  /** Present when a channel drove the delegation — the card is pushed there too. */
  origin?: RoutedApprovalOrigin
}

export function buildRoutedApprovalHandler(
  deps: BuildRoutedApprovalHandlerDeps,
): Required<Pick<DrainLeafTurnOptions, 'onApprovalRequested' | 'onApprovalResolved'>> {
  // Only approvals THIS handler parked resume the gate — an auto-approved card's
  // `approval-resolved` must not release someone else's suspension.
  const parked = new Set<string>()

  return {
    onApprovalRequested: async (event) => {
      try {
        const outcome = await recordApprovalRequest(
          deps.db,
          {
            providerApprovalId: event.approvalRequestId,
            userId: deps.userId,
            workspaceId: deps.workspaceId,
            sessionId: event.sessionId,
            parentMessageId: event.parentMessageId,
            toolUseId: event.approvalRequestId, // chat's placeholder convention (foundation-hardening)
            providerId: DEFAULT_PROVIDER_ID,
            toolName: event.toolName,
            toolInput: event.toolInput,
          },
          { logger: deps.logger },
        )
        if (outcome.kind === 'auto-approved') {
          deps.logger.info(
            { toolName: event.toolName, ruleId: outcome.matchedRuleId },
            'routed approval auto-approved by workspace rule',
          )
          return
        }

        parked.add(event.approvalRequestId)
        deps.waitGate.markParked()

        // Channel push is best-effort: the recorded card already reaches the web
        // notifier, so a channel enqueue failure narrows the surface, never the turn.
        if (deps.origin !== undefined) {
          try {
            enqueueApprovalRequestForRecipient(deps.db, {
              channel: deps.origin.channel,
              externalRecipientId: deps.origin.externalRecipientId,
              externalChatContextId: deps.origin.externalChatContextId,
              card: {
                approvalRequestId: event.approvalRequestId,
                toolName: event.toolName,
                toolInput: event.toolInput,
              },
            })
          } catch (err) {
            deps.logger.warn(
              { err, approvalRequestId: event.approvalRequestId },
              'routed approval channel push failed (the web notifier still has the card)',
            )
          }
        }

        deps.logger.info(
          { toolName: event.toolName, approvalRequestId: event.approvalRequestId },
          'routed approval parked — waiting for a decision (web notifier / origin channel)',
        )
      } catch (err) {
        // Recording failed — no surface can see the card, so deny at the provider
        // (fail-closed, never deadlock) and keep the turn draining. The deny itself
        // is guarded: recordApprovalRequest can throw AFTER its auto-approve path
        // already answered the provider (Tx2 failure), in which case the registry
        // entry is gone and the deny gets NotFound — no park exists, nothing to
        // unblock, and the turn must keep draining rather than fail the whole job.
        deps.logger.error(
          { err, approvalRequestId: event.approvalRequestId, toolName: event.toolName },
          'routed approval recording failed — denying fail-closed',
        )
        try {
          await deps.provider.respondToApprovalRequest(event.approvalRequestId, {
            kind: 'denied',
            reason: ROUTED_LEAF_APPROVAL_DENY_REASON,
          })
        } catch (denyErr) {
          if (denyErr instanceof NotFoundError) {
            deps.logger.info(
              { approvalRequestId: event.approvalRequestId },
              'fail-closed deny found the approval already resolved — no park to unblock',
            )
          } else {
            // A stray pending row (if Tx1 landed) stays reaper-bounded — log, never throw.
            deps.logger.error(
              { err: denyErr, approvalRequestId: event.approvalRequestId },
              'fail-closed deny failed — the reaper bounds any recorded row',
            )
          }
        }
      }
    },

    onApprovalResolved: (event) => {
      if (parked.delete(event.approvalRequestId)) deps.waitGate.markResolved()
    },
  }
}
