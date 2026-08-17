// The SESSION status vocabulary + derivation (Move 3 of the composer arc,
// 2026-08-17) — the per-conversation sibling of
// `workspaces/workspace-status.ts`, and deliberately the SAME model:
//
//   - the ASSISTANT-SET states (`SessionSetStatus`) the `set_session_status`
//     tool writes — facts with a timestamp, superseded by the user's next
//     message (a user message STARTING after `statusSetAt`);
//   - the EFFECTIVE status (`SessionEffectiveStatus`) every surface renders —
//     derived HERE, in one pure home, so the Sessions panel, the node screen's
//     conversation dots, and the global row can never fork the ladder.
//
// Precedence (highest wins, the workspace ladder verbatim): problem →
// needs_input → running → completed → idle. Detection adds: the LATEST
// assistant message errored and nothing runs → problem (the "stuck on the
// session limit" signal, carrying the error text as the note); a pending
// approval on the conversation → needs_input; a live turn → running.

export const SESSION_SET_STATUSES = ['completed', 'problem', 'needs_input'] as const
export type SessionSetStatus = (typeof SESSION_SET_STATUSES)[number]

export type SessionEffectiveStatus =
  | 'running'
  | 'needs_input'
  | 'problem'
  | 'completed'
  | 'idle'

/** The durable FACTS one overview entry carries — everything the derivation
 *  needs except turn liveness (the activity feed is the one live source; the
 *  UI marries the two, the overview-header rule). */
export interface SessionStatusFacts {
  /** The assistant-set state — null when nothing set. */
  setStatus: SessionSetStatus | null
  /** The assistant's one-line why, when it gave one. */
  statusNote: string | null
  /** ISO-8601 — when the set state was written. */
  statusSetAt: string | null
  /** The conversation's latest ASSISTANT message ended in an error and no
   *  newer assistant message exists — "the last thing that happened errored".
   *  Self-clears when a later reply succeeds. */
  lastError: { code: string | null; message: string; at: string } | null
  /** Pending approvals raised by any of the conversation's segments. */
  pendingApprovalCount: number
  /** ISO-8601 start of the latest USER message — the supersession anchor: a
   *  set status stands until the user speaks again ("completed shows until
   *  the next message", the workspace rule). Null when the user never has. */
  latestUserMessageAt: string | null
}

/** What one conversation renders: the colour + the one-line why beside it. */
export interface SessionStatusView {
  status: SessionEffectiveStatus
  /** The set-state's note when the set state is what shows, or the error
   *  message when `problem` came from detection. Null otherwise. */
  note: string | null
}

/** The one home for the session ladder. `liveTurnStartedAt` is the activity
 *  feed's in-flight turn on any of the conversation's segments (null when
 *  quiet) — live truth the durable facts can't carry. */
export function deriveSessionStatus(
  facts: SessionStatusFacts,
  live: { liveTurnStartedAt: string | null },
): SessionStatusView {
  const isRunning = live.liveTurnStartedAt !== null

  // The set state stands unless the user spoke — or a live turn started —
  // after it was written.
  const setAtMs = facts.statusSetAt === null ? null : new Date(facts.statusSetAt).getTime()
  const supersededAtMs = Math.max(
    facts.latestUserMessageAt === null
      ? Number.NEGATIVE_INFINITY
      : new Date(facts.latestUserMessageAt).getTime(),
    live.liveTurnStartedAt === null
      ? Number.NEGATIVE_INFINITY
      : new Date(live.liveTurnStartedAt).getTime(),
  )
  const setStanding =
    facts.setStatus !== null && setAtMs !== null && setAtMs >= supersededAtMs
      ? facts.setStatus
      : null

  // A live turn outdates the failure — the retry shows as running; if it
  // fails again the error refreshes and problem returns on settle.
  const errorStanding = !isRunning && facts.lastError !== null

  const status: SessionEffectiveStatus =
    setStanding === 'problem' || errorStanding
      ? 'problem'
      : facts.pendingApprovalCount > 0 || setStanding === 'needs_input'
        ? 'needs_input'
        : isRunning
          ? 'running'
          : setStanding === 'completed'
            ? 'completed'
            : 'idle'

  // The note travels only when its source is what actually shows.
  const note =
    setStanding !== null && status === setStanding
      ? facts.statusNote
      : status === 'problem' && errorStanding
        ? (facts.lastError?.message ?? null)
        : null

  return { status, note }
}
