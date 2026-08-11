import type { CallMode } from './call-turn-policy.js'

// The pure text contracts a live call runs on — ONE home shared by the daemon
// loop and the local-api conductor tools, so the priming the session receives
// and the sentinel the loop checks can never drift apart.

/** The exact reply a note flush uses to mean "nothing needs my voice". */
export const NOTED_SENTINEL = 'noted'

/** Sentinel check, tolerant of terminal punctuation ('Noted!', 'noted.'). The
 *  design errs toward speaking: "Noted — but flag the deadline" must speak. */
export function isNotedSentinel(reply: string): boolean {
  return reply.trim().toLowerCase().replace(/[.!]+$/, '') === NOTED_SENTINEL
}

export function buildNoteFlushMessage(notes: readonly string[]): string {
  return [
    'Transcript notes from the live call (you are the notetaker):',
    ...notes.map((note) => `- ${note}`),
    '',
    `Reply with exactly '${NOTED_SENTINEL}' unless something here warrants speaking up in the call.`,
  ].join('\n')
}

export interface CallSessionBriefing {
  readonly label: string
  readonly mode: CallMode
  readonly assistantName: string
  /** What the user asked for, in their words — carried verbatim when given. */
  readonly goal?: string | undefined
}

/** The spawned call session's priming purpose — its whole identity. Everything
 *  it replies is SPOKEN into the call, so the contract is spoken prose. */
export function buildCallSessionPurpose(briefing: CallSessionBriefing): string {
  const modeContract =
    briefing.mode === 'notetaker'
      ? `You are the NOTETAKER. Transcript notes arrive in batches — reply with exactly '${NOTED_SENTINEL}' ` +
        'unless something truly warrants speaking up. When someone addresses you by name, their words ' +
        'arrive as a plain message — answer it.'
      : 'You are a PARTICIPANT in a one-to-one conversation. Every message is something the other ' +
        'person just said — reply to each as your turn in the conversation.'
  return [
    `You are ${briefing.assistantName}, live inside the call "${briefing.label}".`,
    modeContract,
    'Everything you reply (except the sentinel) is SPOKEN ALOUD into the call: use short, plain, ' +
      'spoken-style prose — no markdown, lists, code, or URLs. A sentence or two beats a paragraph.',
    ...(briefing.goal !== undefined && briefing.goal.trim() !== ''
      ? [`The user's goal for this call: ${briefing.goal.trim()}`]
      : []),
    'When the call ends you may be asked for a summary — keep track of decisions, open questions, ' +
      'and action items as you go.',
  ].join('\n\n')
}

/** Spoken once at join, deterministically — code announces, never the model.
 *  WORDING IS CHAD'S CALL before real-world use (module note, Part B). */
export function buildCallDisclosureLine(assistantName: string, mode: CallMode): string {
  return mode === 'notetaker'
    ? `Quick heads up — ${assistantName}, an AI assistant, has joined and is taking notes.`
    : `Quick heads up — you're talking with ${assistantName}, an AI assistant.`
}
