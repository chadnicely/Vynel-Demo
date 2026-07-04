// User-scoped core op — toggle a channel's `isEnabled` flag, authorized by
// userId (the tenant boundary) so a global (null-workspace) channel is
// reachable from the user-scoped surface. The workspace-scoped twin is
// `setChannelEnabled`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import type { Channel } from '../repositories/index.js'

export function setChannelEnabledForUser(
  db: Database,
  input: { channelId: string; userId: string; isEnabled: boolean },
): Channel {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  return channelsRepository.updateChannel(db, input.channelId, { isEnabled: input.isEnabled })
}
