// Shared scoping guard for the single-channel core ops. Resolves a channel
// by id AND verifies it belongs to the resolved workspace — the channels
// routes are `workspaceScoped` (blueprint §6), so this is where the
// channel-belongs-to-workspace tenant check lives (the data-standard makes
// a missing tenant filter review-blocking). Throws `NotFoundError` on both
// "absent" and "belongs to another workspace" — identical 404, no
// enumeration leak (error-handling.md "Messages").
//
// Spec: `.claude/rules/data-standard.md` "Ownership / identity" +
// `docs/blueprints/channels/blueprint.md §6`.

import { NotFoundError } from '@vynel/errors'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'
import type { Database } from '@vynel/db'

export function getChannelInWorkspaceOrThrow(
  db: Database,
  channelId: string,
  workspaceId: string,
): Channel {
  const channel = channelsRepository.findChannelById(db, channelId)
  if (!channel || channel.workspaceId !== workspaceId) {
    throw new NotFoundError('channel', channelId)
  }
  return channel
}
