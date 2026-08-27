// `resolveVoiceRequesterOfJob` — was this job asked for by the VOICE thread?
// ONE home for the derivation (voice-requester routing, 2026-08-27), consumed
// by every door that addresses a job's report: the engine's own pushes
// (`resolveJobReportRequester`) and, through the api edge's ambient running-job
// read, a child turn's explicit `send_message` report.
//
// WHY derived, not a column: `parentSessionId` already IS "the asking
// conversation's segment at enqueue" (a workspace sender stamps its primary's
// segment; the voice sender now stamps the spoken thread's — the bug was
// stamping the GLOBAL brain's). The segment row outlives swaps (hidden voice
// segments chain-link and persist), so its `scope` says who asked long after
// the thread has moved on. A workspace requester is never voice — the
// `requesterWorkspaceId` stamp and this derivation are mutually exclusive by
// construction, and the column wins first.
//
// The DELIVERY is addressed at the LIVE voice primary (one per user by partial
// unique index), not the enqueue-time segment: the spoken thread is one
// conversation, and its stable primary id is the address that survives
// compaction swaps. A purged/foreign parent segment — or no live voice thread
// — resolves null, and the caller falls back exactly like a deleted requester
// workspace does: the report terminates at the global root.

import type { Database } from '@vynel/db'
import type { DelegationJob } from '@vynel/orchestration'
import { findChatSessionById } from '@vynel/chat/repositories'
import { findVoicePrimarySessionForUser } from '../continuity/index.js'

export type VoiceRequester = {
  /** The spoken thread's stable primary id — the delivery row's address. */
  voicePrimarySessionId: string
}

export function resolveVoiceRequesterOfJob(
  db: Database,
  job: Pick<DelegationJob, 'userId' | 'parentSessionId' | 'requesterWorkspaceId'>,
): VoiceRequester | null {
  if (job.requesterWorkspaceId !== null) return null
  const askerSegment = findChatSessionById(db, job.parentSessionId)
  if (askerSegment === null || askerSegment.userId !== job.userId) return null
  if (askerSegment.scope !== 'voice') return null
  const voicePrimary = findVoicePrimarySessionForUser(db, job.userId)
  return voicePrimary !== null ? { voicePrimarySessionId: voicePrimary.id } : null
}
