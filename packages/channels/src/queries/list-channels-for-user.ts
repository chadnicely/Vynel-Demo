// Core op — list the channels a user owns (brain-tree Ch4). The global root
// has no workspace, so its `list_routing_channels` tool lists by userId. sync,
// thin wrapper over the repo; the route's `userScoped` middleware resolves the
// caller, so `userId` is the owner.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'

export function listChannelsForUser(db: Database, userId: string): Channel[] {
  return channelsRepository.listChannelsForUser(db, userId)
}
