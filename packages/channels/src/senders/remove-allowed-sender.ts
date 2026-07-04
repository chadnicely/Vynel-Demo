// Core op — remove an allowed sender from a channel's allowlist. sync,
// scoped to the resolved workspace; the repo delete is additionally scoped
// by channelId so a forged senderLinkId can't reach another channel's row.
// Spec: `docs/blueprints/channels/blueprint.md §5`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'

export function removeAllowedSender(
  db: Database,
  input: { channelId: string; workspaceId: string; senderLinkId: string },
): void {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  channelsRepository.deleteAllowedSender(db, input.channelId, input.senderLinkId)
}
