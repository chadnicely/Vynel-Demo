// User-scoped core op — a channel's inbound history (keyset cursor-paginated),
// authorized by userId. The workspace-scoped twin is `listChannelHistory`.

import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from './get-channel-for-user.js'
import type { Database } from '@vynel/db'
import type { ChannelInboundMessage } from '../repositories/index.js'

export interface ListChannelHistoryForUserInput {
  channelId: string
  userId: string
  limit?: number
  cursor?: { receivedAt: Date; id: string }
}

export function listChannelHistoryForUser(
  db: Database,
  input: ListChannelHistoryForUserInput,
): ChannelInboundMessage[] {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  const options: { limit?: number; cursor?: { receivedAt: Date; id: string } } = {}
  if (input.limit !== undefined) options.limit = input.limit
  if (input.cursor !== undefined) options.cursor = input.cursor
  return channelsRepository.listInboundMessagesForChannel(db, input.channelId, options)
}
