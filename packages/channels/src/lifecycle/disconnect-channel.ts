// Core op — disconnect (hard-delete + cascade) a channel, scoped to the
// resolved workspace. sync. The delete + its `channel.disconnected`
// outbox event co-commit in one transaction; an ownership miss throws
// before anything is written, so nothing is emitted.
// Spec: `docs/blueprints/channels/blueprint.md §5`.

import type { Database } from '@vynel/db'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
import { hardDeleteChannelWithEvent } from './hard-delete-channel-with-event.js'

export function disconnectChannel(
  db: Database,
  input: { channelId: string; workspaceId: string },
): void {
  const channel = getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  hardDeleteChannelWithEvent(db, channel) // cascades to child tables (D16)
}
