// Resolve the most-recent chat session for a (channel, sender) so a
// returning sender's turn resumes the same conversation (continuity — §5.5
// / D11). sync (a single indexed DB read). Returns null for a first-time
// sender → the turn starts a fresh session.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.5`.

import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'

export function findRecentChannelSessionId(
  db: Database,
  input: { channelId: string; externalSenderId: string },
): string | null {
  const recent = channelsRepository.findRecentSessionedInboundForSender(
    db,
    input.channelId,
    input.externalSenderId,
  )
  return recent?.routedToChatSessionId ?? null
}
