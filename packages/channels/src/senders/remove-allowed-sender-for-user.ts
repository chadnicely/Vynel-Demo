// User-scoped core op — remove an allowed sender from a channel's allowlist,
// authorized by userId; the repo delete is additionally scoped by channelId so
// a forged senderLinkId can't reach another channel's row. The workspace-scoped
// twin is `removeAllowedSender`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'

export function removeAllowedSenderForUser(
  db: Database,
  input: { channelId: string; userId: string; senderLinkId: string },
): void {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  channelsRepository.deleteAllowedSender(db, input.channelId, input.senderLinkId)
}
