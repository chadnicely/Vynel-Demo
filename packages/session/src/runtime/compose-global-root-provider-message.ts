// `composeGlobalRootProviderMessage` — what the PROVIDER receives for a
// global-root turn, as distinct from what the transcript persists (the clean
// user text). Extracted from `runGlobalRootTurnCore` (file-size cap) — the
// core stays the turn runner; this owns the per-message decorations:
//
//   - Root-awareness catch-up (brain-tree Ch3.5): unseen terminal delegation
//     reports are PREPENDED to the provider input only (the persister keeps
//     the clean original — else the block renders as if the user typed it) and
//     marked surfaced (exactly-once — the injected text reaches the SDK
//     session, so marking at turn-build is correct).
//   - The voice-turn marker: re-states the speak directive AT THE MESSAGE — the
//     system-prompt block alone decays on a long root session and the model
//     slips back to text-only replies.
//   - The channel reply marker: the same for `reply_to_channel`, composed at the
//     channels edge (it knows the sender/group facts) and never persisted.

import type { Database } from '@vynel/db'
import { collectDelegationReportsForRoot, markDelegationsSurfacedToRoot } from '@vynel/orchestration'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'

export type ComposeGlobalRootProviderMessageInput = {
  userId: string
  /** The clean inbound text — what the transcript persists. */
  userMessageText: string
  /** This turn arrived by voice — append the per-message speak marker. */
  voice?: boolean
  /** The channels edge's per-message reply instruction, if any. */
  channelReplyMarker?: string
}

export function composeGlobalRootProviderMessage(
  db: Database,
  input: ComposeGlobalRootProviderMessageInput,
): string {
  const reports = collectDelegationReportsForRoot(db, { userId: input.userId })
  let providerUserMessageText =
    reports.contextBlock !== null
      ? `${reports.contextBlock}\n\n${input.userMessageText}`
      : input.userMessageText
  if (input.voice === true) {
    providerUserMessageText = `${providerUserMessageText}\n\n${loadSessionInstruction('voice-turn-marker')}`
  }
  if (input.channelReplyMarker !== undefined) {
    providerUserMessageText = `${providerUserMessageText}\n\n${input.channelReplyMarker}`
  }
  if (reports.jobIds.length > 0) {
    markDelegationsSurfacedToRoot(db, reports.jobIds, new Date())
  }
  return providerUserMessageText
}
