// Route a channel approval reply back to the approvals domain. Two shapes
// (channels D-approval-reply, "Buttons primary + text"):
//   - Button tap → body is the callback payload `approval:<action>:<id>`
//     (explicit approvalRequestId — unambiguous).
//   - Typed text → `approve` / `deny <reason>`; the target approval is the
//     sender's most-recent surfaced approval (§5.7 text path).
// Resolution always goes through `resolveApproval` (no cross-domain write).
// A short confirmation (or a clarifying status) is enqueued back.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.7`.

import { ConflictError, NotFoundError } from '@vynel/errors'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import * as channelsRepository from '../repositories/index.js'
import { enqueueChannelStatus } from '../delivery/enqueue-channel-status.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type { ProcessInboundDeps } from '../channels-types.js'

type ApprovalDecision = { kind: 'approved' } | { kind: 'denied'; reason: string }

interface ParsedReply {
  decision: ApprovalDecision
  explicitApprovalId: string | null
}

function parseApprovalReply(messageBody: string): ParsedReply | null {
  const trimmed = messageBody.trim()

  // Button payload: approval:<action>:<approvalRequestId>
  if (trimmed.startsWith('approval:')) {
    const parts = trimmed.split(':')
    const action = parts[1]
    const id = parts.slice(2).join(':')
    if (!id) return null
    if (action === 'approve') return { decision: { kind: 'approved' }, explicitApprovalId: id }
    if (action === 'deny') {
      return { decision: { kind: 'denied', reason: 'Denied from channel.' }, explicitApprovalId: id }
    }
    return null
  }

  // Typed: approve | deny <reason>
  if (/^approve\b/i.test(trimmed)) {
    return { decision: { kind: 'approved' }, explicitApprovalId: null }
  }
  const denyMatch = /^deny\b\s*(.*)$/i.exec(trimmed)
  if (denyMatch) {
    const reason = denyMatch[1]?.trim()
    return {
      decision: { kind: 'denied', reason: reason && reason.length > 0 ? reason : 'Denied from channel.' },
      explicitApprovalId: null,
    }
  }
  return null
}

export async function routeAsApprovalReply(
  db: Database,
  input: { channel: Channel; message: ChannelInboundMessage },
  deps: Pick<ProcessInboundDeps, 'resolveApproval' | 'logger'>,
): Promise<void> {
  const parsed = parseApprovalReply(input.message.messageBody)
  if (!parsed) {
    enqueueChannelStatus(
      db,
      input,
      'I couldn’t read that approval reply. Tap Approve/Deny on the request, or reply “approve” or “deny <reason>”.',
    )
    return
  }

  // Find the target approval: explicit (button) or correlated (typed text).
  let approvalRequestId = parsed.explicitApprovalId
  if (approvalRequestId === null) {
    const pending = channelsRepository.findRecentApprovalAwaitingInboundForSender(
      db,
      input.channel.id,
      input.message.externalSenderId,
    )
    approvalRequestId = pending?.routedToApprovalRequestId ?? null
  }
  if (approvalRequestId === null) {
    enqueueChannelStatus(db, input, 'There’s no pending approval to act on.')
    return
  }

  try {
    await deps.resolveApproval(
      db,
      {
        providerApprovalId: approvalRequestId,
        userId: input.channel.userId,
        workspaceId: input.channel.workspaceId,
        providerId: DEFAULT_PROVIDER_ID,
        decision: parsed.decision,
      },
      deps.logger !== undefined ? { logger: deps.logger } : {},
    )
    enqueueChannelStatus(
      db,
      input,
      parsed.decision.kind === 'approved' ? '✅ Approved — continuing now.' : '❌ Denied.',
      'approval-resolved',
    )
  } catch (err) {
    if (err instanceof NotFoundError) {
      enqueueChannelStatus(db, input, 'That approval is no longer available.')
      return
    }
    if (err instanceof ConflictError) {
      enqueueChannelStatus(db, input, 'That approval was already handled.')
      return
    }
    throw err
  }
}
