// User-scoped core op — toggle a channel's `isEnabled` flag, authorized by
// userId (the tenant boundary) so a global (null-workspace) channel is
// reachable from the user-scoped surface. The workspace-scoped twin is
// `setChannelEnabled`. The flip + its `channel.enabled-changed` outbox
// event co-commit in one transaction; an ownership miss throws before
// anything is written, so nothing is emitted.

import type { Database } from '@vynel/db'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import { updateChannelEnabledWithEvent } from './update-channel-enabled-with-event.js'
import type { Channel } from '../repositories/index.js'

export function setChannelEnabledForUser(
  db: Database,
  input: { channelId: string; userId: string; isEnabled: boolean },
): Channel {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  return updateChannelEnabledWithEvent(db, channel, input.isEnabled)
}
