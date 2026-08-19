// A tool call the PROVIDER'S OWN safety check refused before it ran — Claude's
// auto-mode classifier, a deny rule, the mode itself. No approval card was
// ever shown: the refusal short-circuits ahead of the approval callback, the
// model receives a canned rejection in place of a result and stops.
//
// The row settles `status: 'blocked'` and carries this payload as its
// `toolOutput`, so a reload reads the same story the live card told. A deny
// cannot be un-denied in flight; the only honest recovery is to RE-ISSUE the
// intent as a normal message on the same session, so the retry carries what
// the classifier found missing — that message's text lives here too, so every
// surface that offers the button phrases it identically.
//
// Lives in contracts because the writer (the chat consumer) and the readers
// (the tool card, the thread owner that sends) are in leaves that must not
// import each other.

export interface BlockedToolOutput {
  /** The deciding component — 'classifier' | 'rule' | 'mode' | … — or the
   *  generic 'provider' when the provider did not say. */
  blockedBy: string
  /** The component's human-readable reason (already sanitized); null when none. */
  reason: string | null
  /** The rejection text the model received in place of a result. */
  message: string
}

export const BLOCKED_BY_PROVIDER_FALLBACK = 'provider'

export function buildBlockedToolOutput(input: {
  reasonType: string | null
  reason: string | null
  message: string
}): BlockedToolOutput {
  return {
    blockedBy: input.reasonType ?? BLOCKED_BY_PROVIDER_FALLBACK,
    reason: input.reason,
    message: input.message,
  }
}

/** Narrow a row's opaque `toolOutput` back to the blocked payload — null for
 *  anything else (a tool's real output, a denial echo, a placeholder). */
export function readBlockedToolOutput(toolOutput: unknown): BlockedToolOutput | null {
  if (typeof toolOutput !== 'object' || toolOutput === null) return null
  const candidate = toolOutput as Record<string, unknown>
  if (typeof candidate['blockedBy'] !== 'string' || typeof candidate['message'] !== 'string') {
    return null
  }
  const reason = candidate['reason']
  return {
    blockedBy: candidate['blockedBy'],
    reason: typeof reason === 'string' && reason !== '' ? reason : null,
    message: candidate['message'],
  }
}

/** The re-authorization a user sends from the card: an explicit, on-session
 *  statement of intent — exactly what the classifier said it could not see. */
export function reauthorizeToolCallMessage(toolName: string): string {
  return `Approved — go ahead and run ${toolName} exactly as proposed.`
}
