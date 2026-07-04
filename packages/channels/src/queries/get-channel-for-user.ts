// User-scoped ownership guard for the single-channel core ops on the
// user-scoped `/channels` surface (a user's global + workspace channels alike).
// Resolves a channel by id AND verifies it belongs to `userId` — `userId` is
// the tenant boundary (per the schema), NOT `workspaceId`. Throws
// `NotFoundError` on both "absent" and "owned by another user" — identical 404,
// no enumeration leak (error-handling.md "Messages"). The workspace-scoped twin
// is `getChannelInWorkspaceOrThrow`; this one is workspace-agnostic so it
// resolves a global (null-workspace) channel too.

import { NotFoundError } from '@vynel/errors'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'
import type { Database } from '@vynel/db'

export function getChannelForUserOrThrow(
  db: Database,
  channelId: string,
  userId: string,
): Channel {
  const channel = channelsRepository.findChannelById(db, channelId)
  if (!channel || channel.userId !== userId) {
    throw new NotFoundError('channel', channelId)
  }
  return channel
}
