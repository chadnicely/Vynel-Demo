// User-scoped core op — disconnect (hard-delete + cascade) a channel,
// authorized by userId. The workspace-scoped twin is `disconnectChannel`.
// The delete + its `channel.disconnected` outbox event co-commit in one
// transaction; an ownership miss throws before anything is written, so
// nothing is emitted.

import type { Database } from '@vynel/db'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import { hardDeleteChannelWithEvent } from './hard-delete-channel-with-event.js'

export function disconnectChannelForUser(
  db: Database,
  input: { channelId: string; userId: string },
): void {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  hardDeleteChannelWithEvent(db, channel) // cascades to child tables (D16)
}
