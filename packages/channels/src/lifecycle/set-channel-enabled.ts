// Core op — toggle a channel's `isEnabled` flag (disabled channels are
// skipped by the polling loop). sync, scoped to the resolved workspace.
// Spec: `docs/blueprints/channels/blueprint.md §5` + `coding.md §5`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
import type { Channel } from '../repositories/index.js'

export function setChannelEnabled(
  db: Database,
  input: { channelId: string; workspaceId: string; isEnabled: boolean },
): Channel {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  return channelsRepository.updateChannel(db, input.channelId, { isEnabled: input.isEnabled })
}
