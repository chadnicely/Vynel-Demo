// The per-utterance decision for a live call — pure, per the settled call-brain
// model (docs/module-notes/voice-in-calls.md Part C): in a group call Vynel is
// a NOTETAKER — the transcript accumulates and it speaks only when addressed by
// name; in a 1:1 PARTICIPANT call every real utterance deserves a reply. The
// mode is per-call, set by the user through global in conversation — never a
// hardcoded default.

import { isEchoOfSpokenLine } from '../turn-taking/spoken-echo-filter.js'

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

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
