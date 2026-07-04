// Core op — the channel's inbound history (the one growth-scaling list,
// keyset cursor-paginated), scoped to the resolved workspace. sync.
// Spec: `docs/blueprints/channels/blueprint.md §6`.

import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from './get-channel-in-workspace.js'
import type { Database } from '@vynel/db'
import type { ChannelInboundMessage } from '../repositories/index.js'

export interface ListChannelHistoryInput {
  channelId: string
  workspaceId: string
  limit?: number
  cursor?: { receivedAt: Date; id: string }
}

export function listChannelHistory(
  db: Database,
  input: ListChannelHistoryInput,
): ChannelInboundMessage[] {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  const options: { limit?: number; cursor?: { receivedAt: Date; id: string } } = {}
  if (input.limit !== undefined) options.limit = input.limit
  if (input.cursor !== undefined) options.cursor = input.cursor
  return channelsRepository.listInboundMessagesForChannel(db, input.channelId, options)
}
