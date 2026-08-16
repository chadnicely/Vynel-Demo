// The per-utterance decision for a live call — pure, per the settled call-brain
// model (docs/module-notes/voice-in-calls.md Part C): in a group call Vynel is
// a NOTETAKER — the transcript accumulates and it speaks only when addressed by
// name; in a 1:1 PARTICIPANT call every real utterance deserves a reply. The
// mode is per-call, set by the user through global in conversation — never a
// hardcoded default.

export type CallMode = 'notetaker' | 'participant'

export type CallUtteranceDecision =
  | { readonly kind: 'respond' }
  | { readonly kind: 'note' }
  | { readonly kind: 'ignore' }

/** Case-insensitive whole-name mention — "Vynel, can you…" and "what do you
 *  think, vynel?" both address it; "vynelish" does not. Lookarounds rather
 *  than \b: a plain \b never matches after a name that ENDS in a non-word
 *  character (a configured "C-3PO?" would be unaddressable). Unicode classes
 *  rather than \w: ASCII \w would let "José" match inside "Josée". */
export function detectAddressed(assistantName: string, transcript: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeForRegex(assistantName)}(?![\\p{L}\\p{N}_])`,
    'iu',
  ).test(transcript)
}

export function decideCallUtterance(
  mode: CallMode,
  transcript: string,
  assistantName: string,
  recentSpokenLines: readonly string[] = [],
): CallUtteranceDecision {
  if (transcript.trim() === '') return { kind: 'ignore' }
  if (isEchoOfSpokenLine(transcript, recentSpokenLines)) return { kind: 'ignore' }
  if (mode === 'participant') return { kind: 'respond' }
  return detectAddressed(assistantName, transcript) ? { kind: 'respond' } : { kind: 'note' }
}

/** A live call can hear Vynel's own words again: the far end plays them on a
 *  speaker, its mic picks them up, and they arrive back as a "user" utterance
 *  (observed verbatim on the 2026-08-16 Meet call — each echo then CUT the
 *  next line, so Vynel kept interrupting itself). An utterance whose words sit
 *  word-bounded inside a recently spoken line is that echo. The accepted cost:
 *  a human genuinely parroting a phrase of Vynel's within the echo window is
 *  swallowed too — far cheaper than the self-interruption loop. */
export function isEchoOfSpokenLine(
  transcript: string,
  recentSpokenLines: readonly string[],
): boolean {
  const heard = normalizeForEchoMatch(transcript)
  // One or two characters ("a", "it") carry no echo evidence.
  if (heard.length < 3) return false
  return recentSpokenLines.some((line) =>
    ` ${normalizeForEchoMatch(line)} `.includes(` ${heard} `),
  )
}

function normalizeForEchoMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
