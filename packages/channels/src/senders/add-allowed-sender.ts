// Core op — add an allowed sender to a channel's allowlist. sync, scoped
// to the resolved workspace. Spec: `docs/blueprints/channels/blueprint.md §5`.

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
import { buildNewAllowedSenderRow } from './build-new-allowed-sender-row.js'
import type { ChannelUserLink } from '../repositories/index.js'

export interface AddAllowedSenderInput {
  channelId: string
  workspaceId: string
  externalSenderId: string
  externalSenderHandle?: string | null
  externalSenderDisplayName?: string | null
  scopeContextId?: string | null
}

export function addAllowedSender(db: Database, input: AddAllowedSenderInput): ChannelUserLink {
  getChannelInWorkspaceOrThrow(db, input.channelId, input.workspaceId)
  return channelsRepository.insertAllowedSender(db, buildNewAllowedSenderRow(input))
}
