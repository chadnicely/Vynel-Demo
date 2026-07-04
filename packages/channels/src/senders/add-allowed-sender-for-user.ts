// User-scoped core op — add an allowed sender to a channel's allowlist,
// authorized by userId. The workspace-scoped twin is `addAllowedSender`; both
// build the row via `buildNewAllowedSenderRow` (the one home for the defaults).

import type { Database } from '@vynel/db'
import * as channelsRepository from '../repositories/index.js'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import { buildNewAllowedSenderRow } from './build-new-allowed-sender-row.js'
import type { ChannelUserLink } from '../repositories/index.js'

export interface AddAllowedSenderForUserInput {
  channelId: string
  userId: string
  externalSenderId: string
  externalSenderHandle?: string | null
  externalSenderDisplayName?: string | null
  scopeContextId?: string | null
}

export function addAllowedSenderForUser(
  db: Database,
  input: AddAllowedSenderForUserInput,
): ChannelUserLink {
  getChannelForUserOrThrow(db, input.channelId, input.userId)
  return channelsRepository.insertAllowedSender(db, buildNewAllowedSenderRow(input))
}
