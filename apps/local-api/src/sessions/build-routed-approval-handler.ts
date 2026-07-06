// `buildRoutedApprovalHandler` — the surface-up SURFACING half for a routed
// delegation's carded tools. RECORDING lives inside the shared consumption
// pipeline now (`consumeSessionEventStream` → `handleApprovalRequested` →
// `recordApprovalRequest`, workspace-scoped, rules evaluated) — the same one
// path every turn type uses. What remains here is what the pipeline can't know:
//
//   - the ORIGIN CHANNEL push (a Telegram-driven job also gets the ✅/❌ card);
//   - the `ApprovalWaitGate` park/resolve edges (suspend `routeRequest`'s wait
//     budget while a human decides — decision C);
//   - `abandonParked` — best-effort denial of anything still parked when the
//     turn THROWS mid-park, so the SDK agent isn't left hanging on a Promise
//     nobody will answer. This only covers approvals that were YIELDED and
//     parked; a record that throws before yielding never reaches here — the
//     runner's interrupt-on-throw tears that turn down instead.
//
// An auto-approved card arrives as `approval-auto-resolved` (a different event
// kind) and deliberately never parks or pushes.

import type { Logger } from 'pino'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { AiAgentProvider } from '@vynel/providers'
import type { ChatTurnEvent } from '@vynel/chat'
import { enqueueApprovalRequestForRecipient, type Channel } from '@vynel/channels'
import { ROUTED_LEAF_APPROVAL_DENY_REASON, type ApprovalWaitGate } from '@vynel/orchestration'

type ApprovalRequestedTurnEvent = Extract<ChatTurnEvent, { kind: 'approval-requested' }>
type ApprovalResolvedTurnEvent = Extract<ChatTurnEvent, { kind: 'approval-resolved' }>

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
  /** Shared with `routeRequest` — parked approvals suspend the wait budget. */
  waitGate: ApprovalWaitGate
  /** Present when a channel drove the delegation — the card is pushed there too. */
  origin?: RoutedApprovalOrigin
  /** The acting workspace's display name — context on the channel card. */
  workspaceName?: string
}

export interface RoutedApprovalHandler {
  onApprovalRequested: (event: ApprovalRequestedTurnEvent) => void
  onApprovalResolved: (event: ApprovalResolvedTurnEvent) => void
  /** Deny anything still parked (the turn threw mid-park) — fail-closed, never
   *  a hang; NotFound (already resolved/cancelled) is tolerated. */
  abandonParked: () => Promise<void>
}

export function buildRoutedApprovalHandler(
  deps: BuildRoutedApprovalHandlerDeps,
): RoutedApprovalHandler {
  // Only approvals THIS handler parked resume the gate — an auto-approved card's
  // resolution must not release someone else's suspension.
  const parked = new Set<string>()

  return {
    onApprovalRequested: (event) => {
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
              ...(deps.workspaceName !== undefined
                ? { workspaceName: deps.workspaceName }
                : {}),
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
    },

    onApprovalResolved: (event) => {
      if (parked.delete(event.approvalRequestId)) deps.waitGate.markResolved()
    },

    abandonParked: async () => {
      for (const approvalRequestId of parked) {
        try {
          await deps.provider.respondToApprovalRequest(approvalRequestId, {
            kind: 'denied',
            reason: ROUTED_LEAF_APPROVAL_DENY_REASON,
          })
        } catch (err) {
          if (!(err instanceof NotFoundError)) {
            deps.logger.warn(
              { err, approvalRequestId },
              'abandoning a parked approval failed (the reaper bounds the recorded row)',
            )
          }
        }
        deps.waitGate.markResolved()
      }
      parked.clear()
    },
  }
}
