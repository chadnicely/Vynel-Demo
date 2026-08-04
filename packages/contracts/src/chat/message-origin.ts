// `deriveMessageOrigin` — ONE home for "who spoke this message, from where"
// (persona-sessions: every message is attributed — from the user, from a
// session/persona, or from a channel). The row already encodes it across three
// columns (`role`, `sourceKind`+`sourceLabel`, `originChannel`); this resolver
// is the single reading both the UI rows and channel formatting derive from,
// so the two can never disagree on what a row IS.

export type MessageOriginKind = 'user' | 'session' | 'channel'

export interface DeriveMessageOriginInput {
  role: 'user' | 'assistant'
  /** The row's attribution — who produced it in the session tree. */
  sourceKind: string | null
  /** The producing persona/session's display label ("Mark · Acme" / "Nova"). */
  sourceLabel: string | null
  /** The inbound channel a USER row arrived through; null = the app composer. */
  originChannel: string | null
}

export interface MessageOrigin {
  origin: MessageOriginKind
  /** The display label for the origin: the persona label for 'session', the
   *  channel kind for 'channel', null for the user themself (the surface
   *  already knows who its user is). */
  label: string | null
}

export function deriveMessageOrigin(input: DeriveMessageOriginInput): MessageOrigin {
  if (input.role === 'assistant') {
    // An assistant row always speaks as a session — the surface's own persona
    // when unattributed, the named persona when a routed turn stamped one.
    return { origin: 'session', label: input.sourceLabel }
  }
  // A user-role row: a system-relayed message (a routed task, a report/update
  // delivery) carries sourceKind — it is another SESSION speaking, not the
  // user, regardless of any channel marker.
  if (input.sourceKind !== null && input.sourceKind !== 'user') {
    return { origin: 'session', label: input.sourceLabel }
  }
  if (input.originChannel !== null) {
    return { origin: 'channel', label: input.originChannel }
  }
  return { origin: 'user', label: null }
}
