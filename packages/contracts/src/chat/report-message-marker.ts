// The per-message attribution marker on a delivered report (session-comms).
//
// WHY: the notify turn's inbound is a USER-role message, and a system-prompt
// steer alone does not hold — Chad's 2026-07-27 smoke caught the workspace
// reasoning "the user is reporting back the result…" about a report the SYSTEM
// delivered, so it summarized for the user instead of relaying the result up
// to its requester. The same instruction-decay class the voice work hit; the
// proven fix is a marker ON the message itself. The delivery tick prepends it
// (the model always sees it); the report card strips it (the row's author line
// already carries the identity). One home for both ends so they cannot drift.

const MARKER_PREFIX = '[Report from '
const UPDATE_MARKER_PREFIX = '[Update from '
const DIRECT_MARKER_PREFIX = '[Message from '

export function composeReportMessageMarker(sourceLabel: string): string {
  return (
    `${MARKER_PREFIX}${sourceLabel} — the result of work you delegated, ` +
    'relayed automatically by Vynel. This is NOT a message the user typed.]'
  )
}

/** The interim sibling (persona-sessions): a spoken ack/progress update —
 *  explicitly NOT the result, so the requester never treats the task as done. */
export function composeUpdateMessageMarker(sourceLabel: string): string {
  return (
    `${UPDATE_MARKER_PREFIX}${sourceLabel} — an interim status on work you delegated, ` +
    'relayed automatically by Vynel. The task is STILL RUNNING; this is NOT its result ' +
    'and NOT a message the user typed.]'
  )
}

/** The `direct_to_user` variant: the sender's FINAL answer addressed to the
 *  USER, persisted straight onto the requester's transcript with no notify
 *  turn. The model-facing text matters on the fallback path only (no root row
 *  to land on → the notify machinery delivers it), where the requester must
 *  absorb without restating — the message was never addressed to it. */
export function composeDirectMessageMarker(sourceLabel: string): string {
  return (
    `${DIRECT_MARKER_PREFIX}${sourceLabel} — addressed DIRECTLY to the user and shown to them ` +
    'in this conversation, relayed automatically by Vynel. Not a message the user typed; ' +
    'do not restate it.]'
  )
}

/** True when the body carries the INTERIM-update marker (vs the final report) —
 *  the UI's one reading for the Report/Update badge split. */
export function isUpdateMessageBody(body: string): boolean {
  return body.startsWith(UPDATE_MARKER_PREFIX)
}

/** True when the body carries the direct-to-user marker — the badge reads
 *  "Message": the sender speaking TO the user, not reporting to its requester. */
export function isDirectMessageBody(body: string): boolean {
  return body.startsWith(DIRECT_MARKER_PREFIX)
}

/** Drops the marker line (and its trailing blank) from a report/update body for
 *  display. Anything not starting with a marker prefix passes through
 *  untouched — including a report whose PROSE mentions "[Report from" later.
 *  The marker is by construction ONE line, so the strip removes the whole
 *  first line — never a substring hunt for `']'`, which a user-chosen
 *  workspace name like "Q3 [phase 2]" would defeat. */
export function stripReportMessageMarker(body: string): string {
  if (
    !body.startsWith(MARKER_PREFIX) &&
    !body.startsWith(UPDATE_MARKER_PREFIX) &&
    !body.startsWith(DIRECT_MARKER_PREFIX)
  ) {
    return body
  }
  const lineEnd = body.indexOf('\n')
  const firstLine = lineEnd === -1 ? body : body.slice(0, lineEnd)
  if (!firstLine.trimEnd().endsWith(']')) return body
  if (lineEnd === -1) return ''
  return body.slice(lineEnd + 1).replace(/^\s+/, '')
}
