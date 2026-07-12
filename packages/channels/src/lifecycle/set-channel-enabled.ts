// Core op — toggle a channel's `isEnabled` flag (disabled channels are
// skipped by the polling loop). sync, scoped to the resolved workspace.
// The flip + its `channel.enabled-changed` outbox event co-commit in one
// transaction; an ownership miss throws before anything is written, so
// nothing is emitted.
// Spec: `docs/blueprints/channels/blueprint.md §5` + `coding.md §5`.

import type { Database } from '@vynel/db'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
import { updateChannelEnabledWithEvent } from './update-channel-enabled-with-event.js'
import type { Channel } from '../repositories/index.js'

export function setChannelEnabled(
  db: Database,
  input: { channelId: string; workspaceId: string; isEnabled: boolean },
): Channel {
  const channel = getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  return updateChannelEnabledWithEvent(db, channel, input.isEnabled)
}
