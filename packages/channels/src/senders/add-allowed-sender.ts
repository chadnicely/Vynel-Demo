// Core op — add an allowed sender to a channel's allowlist. sync, scoped
// to the resolved workspace. Spec: `docs/blueprints/channels/blueprint.md §5`.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelInWorkspaceOrThrow } from '../queries/get-channel-in-workspace.js'
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
  return channelsRepository.insertAllowedSender(db, {
    id: randomUUID(),
    channelId: input.channelId,
    externalSenderId: input.externalSenderId,
    externalSenderHandle: input.externalSenderHandle ?? null,
    externalSenderDisplayName: input.externalSenderDisplayName ?? null,
    // Default scope = the sender id (Telegram DM, where chat id == user id).
    scopeContextId: input.scopeContextId ?? input.externalSenderId,
    addedAt: new Date(),
  })
}
