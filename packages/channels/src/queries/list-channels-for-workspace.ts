// Core op — list the channels for a workspace. sync, thin wrapper over the
// repo. The route's `workspaceScoped` middleware already verified the
// workspace is owned by the caller, so no extra tenant check is needed
// here. Spec: `docs/blueprints/channels/blueprint.md §5`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'

export function listChannelsForWorkspace(db: Database, workspaceId: string): Channel[] {
  return channelsRepository.listChannelsForWorkspace(db, workspaceId)
}
