// Builds the `channel_user_links` insert row from the caller-supplied sender
// fields — the ONE home for the allowlist row defaults (a fresh id, an
// `addedAt` stamp, and `scopeContextId` defaulting to the sender id: Telegram
// DMs where the chat id equals the user id). Shared by the workspace-scoped
// `addAllowedSender` and the user-scoped `addAllowedSenderForUser` so the
// defaulting lives in one place.

import { randomUUID } from 'node:crypto'
import type { NewChannelUserLink } from '../repositories/index.js'

export interface NewAllowedSenderFields {
  channelId: string
  externalSenderId: string
  externalSenderHandle?: string | null
  externalSenderDisplayName?: string | null
  scopeContextId?: string | null
}

export function buildNewAllowedSenderRow(fields: NewAllowedSenderFields): NewChannelUserLink {
  return {
    id: randomUUID(),
    channelId: fields.channelId,
    externalSenderId: fields.externalSenderId,
    externalSenderHandle: fields.externalSenderHandle ?? null,
    externalSenderDisplayName: fields.externalSenderDisplayName ?? null,
    // Default scope = the sender id (Telegram DM, where chat id == user id).
    scopeContextId: fields.scopeContextId ?? fields.externalSenderId,
    addedAt: new Date(),
  }
}
