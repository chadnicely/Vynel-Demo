// Core op — list a channel's allowlist, scoped to the resolved workspace.
// sync. Spec: `docs/blueprints/channels/blueprint.md §6`.

import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
import type { Database } from '@vynel/db'
import type { ChannelUserLink } from '../repositories/index.js'

export function listAllowedSendersForChannel(
  db: Database,
  input: { channelId: string; workspaceId: string },
): ChannelUserLink[] {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  return channelsRepository.listAllowedSenders(db, input.channelId)
}
