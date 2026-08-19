// `composeGlobalRootProviderMessage` — what the PROVIDER receives for a
// global-root turn, as distinct from what the transcript persists (the clean
// user text). Extracted from `runGlobalRootTurnCore` (file-size cap) — the
// core stays the turn runner; this owns the per-message decorations:
//
//   - Root-awareness catch-up (brain-tree Ch3.5): unseen terminal delegation
//     reports are PREPENDED to the provider input only (the persister keeps
//     the clean original — else the block renders as if the user typed it).
//     The job ids come back to the CALLER, which marks them surfaced once the
//     turn is provably underway (session-hardening A4): marking here, before
//     `startChatSession`, lost every failure notice and `direct_to_user`
//     answer to a startup failure — the collector is the ONLY channel by which
//     the root learns those, and `surfacedToRootAt` is a one-way latch.
//   - The voice-turn marker: re-states the speak directive AT THE MESSAGE — the
//     system-prompt block alone decays on a long root session and the model
//     slips back to text-only replies.
//   - The channel reply marker: the same for `reply_to_channel`, composed at the
//     channels edge (it knows the sender/group facts) and never persisted.

import type { Database } from '@vynel/db'
import { collectDelegationReportsForRoot } from '@vynel/orchestration'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'

export type ComposeGlobalRootProviderMessageInput = {
  userId: string
  /** The clean inbound text — what the transcript persists. */
  userMessageText: string
  /** This turn arrived by voice — append the per-message speak marker. */
  voice?: boolean
  /** The channels edge's per-message reply instruction, if any. */
  channelReplyMarker?: string
  /** An automatic CONTINUATION of the genuine turn (session-continuity §4.6):
   *  the catch-up was collected by the genuine turn under the same lock, so a
   *  continuation never re-collects (nor re-marks). */
  continuation?: boolean
}

export type GlobalRootProviderMessage = {
  providerUserMessageText: string
  /** The catch-up jobs this message carries — the caller marks them surfaced
   *  once the turn is underway. Empty when nothing was injected. */
  catchUpJobIds: string[]
}

export function composeGlobalRootProviderMessage(
  db: Database,
  input: ComposeGlobalRootProviderMessageInput,
): GlobalRootProviderMessage {
  // The catch-up block belongs to the GLOBAL conversation: the collector is
  // user-wide and marks reports surfaced exactly-once, so a VOICE-thread turn
  // absorbing it would silently steal the reports from the global chat
  // (voice-session arc — reports stay addressed to global; the voice thread
  // fires work but never holds the ledger).
  const reports =
    input.voice === true || input.continuation === true
      ? { contextBlock: null, jobIds: [] as string[] }
      : collectDelegationReportsForRoot(db, { userId: input.userId })
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
  return { providerUserMessageText, catchUpJobIds: reports.jobIds }
}
