// User-scoped core op — list a channel's allowlist, authorized by userId. The
// workspace-scoped twin is `listAllowedSendersForChannel`.

import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import type { Database } from '@vynel/db'
import type { ChannelUserLink } from '../repositories/index.js'

export function listAllowedSendersForUser(
  db: Database,
  input: { channelId: string; userId: string },
): ChannelUserLink[] {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  return channelsRepository.listAllowedSenders(db, input.channelId)
}
