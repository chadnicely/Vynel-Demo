// User-scoped core op — disconnect (hard-delete + cascade) a channel,
// authorized by userId. The workspace-scoped twin is `disconnectChannel`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'

export function disconnectChannelForUser(
  db: Database,
  input: { channelId: string; userId: string },
): void {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  channelsRepository.hardDeleteChannel(db, input.channelId) // cascades to child tables (D16)
}
