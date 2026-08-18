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
const NOTE_MARKER_PREFIX = '[Note from '
const SYSTEM_MARKER_PREFIX = '[System notification from '

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

/** The `note` variant (session-comms, the lateral kind): plain communication
 *  from one session/workspace to another — never work, never a result. The
 *  reply address rides IN the marker because the receiver may hold no listing
 *  tool to discover it (a spawned session's plain set); the marker is still by
 *  construction ONE line, so the shared strip keeps working. NOT `direct_` —
 *  `[Message from …]` already means "addressed to the USER", and two markers
 *  whose names rhyme but whose destinations oppose would be the exact
 *  confusable pair the kind naming avoided. */
export function composeNoteMessageMarker(sourceLabel: string, replyAddress?: string): string {
  return (
    `${NOTE_MARKER_PREFIX}${sourceLabel} — a note from another session, relayed ` +
    'automatically by Vynel. It is NOT a task and NOT a message the user typed.' +
    (replyAddress !== undefined
      ? ` To answer it, send_message to "${replyAddress}" with kind "note".]`
      : ']')
  )
}

/** The SYSTEM variant (task-execution arc): a machine-produced notification —
 *  the pickup nudge, a schedule failure, a monitor wake — delivered through
 *  the same notify engine but authored by VYNEL, not by any session. The
 *  receiver acts on it per its standing instructions; nobody awaits a report
 *  of it. */
export function composeSystemMessageMarker(sourceLabel: string): string {
  return (
    `${SYSTEM_MARKER_PREFIX}${sourceLabel} — produced automatically by Vynel. ` +
    'NOT a message the user typed and NOT a delegated result: act on it per your ' +
    'standing instructions; no requester is awaiting a report.]'
  )
}

/** True when the body carries the INTERIM-update marker (vs the final report) —
 *  the UI's one reading for the Report/Update badge split. */
export function isUpdateMessageBody(body: string): boolean {
  return body.startsWith(UPDATE_MARKER_PREFIX)
}

/** True when the body carries the note marker — the badge reads "Note": one
 *  session telling another something, no task attached. */
export function isNoteMessageBody(body: string): boolean {
  return body.startsWith(NOTE_MARKER_PREFIX)
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
    !body.startsWith(DIRECT_MARKER_PREFIX) &&
    !body.startsWith(NOTE_MARKER_PREFIX) &&
    !body.startsWith(SYSTEM_MARKER_PREFIX)
  ) {
    return body
  }
  const lineEnd = body.indexOf('\n')
  const firstLine = lineEnd === -1 ? body : body.slice(0, lineEnd)
  if (!firstLine.trimEnd().endsWith(']')) return body
  if (lineEnd === -1) return ''
  return body.slice(lineEnd + 1).replace(/^\s+/, '')
}
