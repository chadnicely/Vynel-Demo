// User-scoped core op — every group room the bot has been seen in for one
// channel the user owns (pending + approved + ignored; the Manage dialog
// renders all three). Authorized by userId via `getChannelForUserOrThrow`.

import type { Database } from '@vynel/db'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import * as channelsRepository from '../repositories/index.js'
import type { ChannelChatGroup } from '../repositories/index.js'

export function listGroupsForUser(
  db: Database,
  input: { channelId: string; userId: string },
): ChannelChatGroup[] {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  return channelsRepository.listChannelChatGroups(db, channel.id)
}
