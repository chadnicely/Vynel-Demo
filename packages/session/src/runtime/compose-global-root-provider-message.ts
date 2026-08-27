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
//   - The turn-time marker: what time it is where the user is. The model reads
//     no clock, so a relative question ("in 15 minutes") was answered off a
//     guessed hour; it rides every turn, like its twin in `start-chat-turn.ts`.
//   - The voice-turn marker: re-states the spoken directive AT THE MESSAGE (heard
//     as you write — short spoken sentences) — the system-prompt block alone decays
//     on a long root session and the model slips back to prose-shaped replies.
//   - The autopilot marker (D8): the same per-message discipline for a
//     conversation whose `autoBuildout` setting is on.
//   - The channel reply marker: the same for `reply_to_channel`, composed at the
//     channels edge (it knows the sender/group facts) and never persisted.

import type { Database } from '@vynel/db'
import { collectDelegationReportsForRoot } from '@vynel/orchestration'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import { resolveTurnTimeMarker } from './resolve-turn-time-marker.js'
import { resolveSurvivorCheckpointMarker } from '../continuity/index.js'
import { resolveVoiceRequesterOfJob } from '../delegation/resolve-voice-requester.js'

export type ComposeGlobalRootProviderMessageInput = {
  userId: string
  /** The clean inbound text — what the transcript persists. */
  userMessageText: string
  /** The turn's continuing identity — the restart-survivor marker reads its
   *  slot. Omit and no survivor marker is composed. */
  primarySessionId?: string
  /** False for a delivery / notify turn: it never continues work, so the
   *  survivor marker (which promises a pick-up) must not ride it. */
  autoContinue?: boolean
  /** This turn arrived by voice — append the per-message speak marker. */
  voice?: boolean
  /** The conversation runs on autopilot — append the per-message marker. */
  autoBuildout?: boolean
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
  // (voice-session arc). The inverse holds too (voice-requester routing): a
  // VOICE-ASKED job's outcome is the spoken thread's — its delivery pipeline
  // is how the voice conversation learns — so the global narration excludes
  // it (the collector still returns its id and the latch retires it from the
  // scan; the voice thread needs no net of its own, because every voice
  // delivery — direct included — runs as a real turn on it).
  const reports =
    input.voice === true || input.continuation === true
      ? { contextBlock: null, jobIds: [] as string[] }
      : collectDelegationReportsForRoot(db, {
          userId: input.userId,
          belongsToRoot: (job) => resolveVoiceRequesterOfJob(db, job) === null,
        })
  let providerUserMessageText =
    reports.contextBlock !== null
      ? `${reports.contextBlock}\n\n${input.userMessageText}`
      : input.userMessageText
  providerUserMessageText = `${providerUserMessageText}

${resolveTurnTimeMarker(db, input.userId)}`
  // The RESTART-SURVIVOR marker (audit r2 R2-H): a checkpoint still pending as
  // a GENUINE turn is composed was left by an earlier turn — the model must
  // learn it owes that step rather than overwrite it blind. Never on a
  // continuation (its own checkpoint is already consumed) and never on a
  // delivery turn, which would promise a pick-up it never makes.
  const survivorMarker =
    input.primarySessionId !== undefined &&
    input.continuation !== true &&
    input.autoContinue !== false
      ? resolveSurvivorCheckpointMarker(db, input.primarySessionId)
      : null
  if (survivorMarker !== null) {
    providerUserMessageText = `${providerUserMessageText}\n\n${survivorMarker}`
  }
  if (input.voice === true) {
    providerUserMessageText = `${providerUserMessageText}\n\n${loadSessionInstruction('voice-turn-marker')}`
  }
  if (input.autoBuildout === true) {
    providerUserMessageText = `${providerUserMessageText}\n\n${loadSessionInstruction('autopilot-marker')}`
  }
  if (input.channelReplyMarker !== undefined) {
    providerUserMessageText = `${providerUserMessageText}\n\n${input.channelReplyMarker}`
  }
  return { providerUserMessageText, catchUpJobIds: reports.jobIds }
}
