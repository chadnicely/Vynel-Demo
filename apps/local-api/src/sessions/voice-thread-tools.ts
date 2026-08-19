// The tools a VOICE-THREAD turn must NOT have — ONE home for the rule, applied
// by both spoken legs: the wake / overlay / typed-panel turn
// (`streams/global-root-turn.ts`, `input.voice`) and the live-call turn
// (`streams/session-turn.ts`, `voice: true`).
//
// Today the set is exactly `speak`. WHY: on a voice thread the model's own
// streamed TEXT is what the user hears (voice-realtime VR1) — the daemon, the
// wake overlay and the Voice chat panel speak the `text-chunk` deltas sentence
// by sentence as they arrive. A `speak` call on that surface would say the
// answer TWICE, and it costs a whole tool round-trip before the first syllable
// (the latency the arc exists to remove). Every OTHER surface keeps the tool
// unchanged: a typed global chat, a schedule fire, a report delivery all still
// speak through the daemon relay, and that relay is the only voice they have.
//
// DENY, not omit. `deniedMcpToolPatterns` reaches the provider as the SDK's
// `disallowedTools`, so the `vynel` server stays REGISTERED with its full
// inventory and only this one tool becomes uncallable. Omitting it would mean
// building a DIFFERENT server for the spoken thread — and a resumed SDK session
// whose server inventory shrinks is the "MCP server disconnected" class
// `build-workspace-background-mcp.ts` exists to prevent. Capability gating
// already denies live tools through exactly this seam.
//
// Applied UNCONDITIONALLY on a voice turn, both legs. The call leg composes no
// `vynel` server today (a call session is spawned + global-grounded, so it gets
// the session descriptor plus desktop) — but that is an accident of GROUNDING,
// not policy: a global-grounded agent-scope session routed through
// `buildDelegatedTurnMcpComposer` does compose the routing descriptor. The rule
// belongs to the SURFACE, so it is stated once here and applied whichever
// branch composed the turn.

import type { ComposedSessionMcpServers } from './compose-session-mcp-servers.js'

/** The spoken thread's forbidden tools (see the file header). Pinned against
 *  the generated routing inventory by the colocated test, so a rename of the
 *  route's `x-mcp` name cannot silently un-deny it. */
export const VOICE_THREAD_DENIED_TOOL_NAMES: readonly string[] = ['mcp__vynel__speak']

/** The composed attachment with the spoken thread's denials folded in. Additive
 *  and idempotent — a tool a gate already denied is not listed twice. */
export function withVoiceThreadToolDenials(
  composed: ComposedSessionMcpServers,
): ComposedSessionMcpServers {
  const added = VOICE_THREAD_DENIED_TOOL_NAMES.filter(
    (toolName) => !composed.deniedMcpToolPatterns.includes(toolName),
  )
  if (added.length === 0) return composed
  return { ...composed, deniedMcpToolPatterns: [...composed.deniedMcpToolPatterns, ...added] }
}
