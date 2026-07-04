// The invoke-Claude seam AND the concurrency-critical op. The api-side
// service fires this CONCURRENTLY per pending row, so the atomic claim is
// mandatory: claim first (pending -> routed); only the winner proceeds —
// otherwise the 1s loop re-fires a still-running long turn (coding.md §1.2).
//
// Lifecycle: claim -> route by intent -> mark terminal (completed/failed).
// Never swallow — failures mark the row failed + log (error-handling.md).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.4`.

import * as channelsRepository from '../repositories/index.js'
import { routeAsChatTurn } from './route-as-chat-turn.js'
import { routeAsApprovalReply } from './route-as-approval-reply.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import type { Database } from '@vynel/db'
import type { ProcessInboundDeps } from '../channels-types.js'

export async function processInboundMessage(
  db: Database,
  input: { inboundMessageId: string },
  deps: ProcessInboundDeps,
): Promise<void> {
  // 1. Claim atomically. If another concurrent tick already took it, bail.
  if (!channelsRepository.claimPendingInboundMessage(db, input.inboundMessageId)) return

  const message = channelsRepository.findInboundMessageById(db, input.inboundMessageId)
  if (!message) return // claimed then vanished (defensive)

  const channel = channelsRepository.findChannelById(db, message.channelId)
  if (!channel) {
    channelsRepository.updateInboundMessage(db, message.id, {
      status: 'failed',
      statusMessage: 'channel no longer exists',
      processedAt: new Date(),
    })
    return
  }

  // 2. Route by intent, then mark terminal.
  try {
    switch (message.intentKind) {
      case 'chat-turn':
        await routeAsChatTurn(db, { channel, message }, deps)
        break
      case 'approval-reply':
        await routeAsApprovalReply(
          db,
          { channel, message },
          {
            resolveApproval: deps.resolveApproval,
            ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          },
        )
        break
      case 'channel-command':
        // Phase 1: no-op stub — /help, /new, /status are Phase 1.5.
        break
      case 'ignored':
        break // never reaches here (only 'pending' rows are claimed)
    }
    channelsRepository.updateInboundMessage(db, message.id, {
      status: 'completed',
      processedAt: new Date(),
    })
  } catch (err) {
    channelsRepository.updateInboundMessage(db, message.id, {
      status: 'failed',
      statusMessage: extractErrorMessage(err),
      processedAt: new Date(),
    })
    deps.logger?.warn(
      { error: extractErrorMessage(err), inboundMessageId: message.id },
      'channel processing failed',
    )
  }
}
