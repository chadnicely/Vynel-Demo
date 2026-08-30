// THE CONVERSATION (Chad, 2026-08-29). A filmed video is three exchanges, and
// every reply is PRE-RECORDED — the whole point is a take with zero latency:
//
//   1. "Hey Pacino, what's up?"      → "Everything is good, boss."  → reveal
//   2. "How we looking on software?" → "Let me check in with the dev log…" → nodes
//   3. "Thanks, Pacino!"             → "You're welcome, boss!"      → black
//
// The replies live here, in one place, because the audio bank records exactly
// these strings — a reply reworded in one spot but not the other would come
// out in the wrong voice, synthesized live, with the latency the film exists
// to cut out.

export const DEMO_CONVERSATION_REPLIES = {
  /** Exchange one — answered over the black, before the room comes on. */
  opening: "Everything is good, boss.",
  /** Exchange two — answered on the orb, then the film cuts to the products. */
  software: "Let me check in with the dev log and give you a brief report.",
  /** Exchange three — the sign-off. After it, the show goes to black. */
  closing: "You're welcome, boss!",
} as const;

/** Every reply, for the recording pass — spoken in every take, so they are
 *  banked alongside the take's own lines. */
export function demoReplyLines(): readonly string[] {
  return Object.values(DEMO_CONVERSATION_REPLIES);
}

/** Is this spoken command the sign-off? Checked BEFORE the software match: a
 *  thank-you carries no software words, and falling through would restart the
 *  video instead of ending it. */
export function isClosingRequest(command: string): boolean {
  return /\b(thanks?|thank\s+you|appreciate)\b/i.test(command);
}
