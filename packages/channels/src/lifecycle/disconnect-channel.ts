// Core op — disconnect (hard-delete + cascade) a channel, scoped to the
// resolved workspace. sync. Spec: `docs/blueprints/channels/blueprint.md §5`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'

export function disconnectChannel(
  db: Database,
  input: { channelId: string; workspaceId: string },
): void {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  channelsRepository.hardDeleteChannel(db, input.channelId) // cascades to child tables (D16)
}
