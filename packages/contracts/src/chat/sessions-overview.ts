// The sessions-overview wire vocabulary (`GET /sessions/overview`) — the
// unified cross-scope session list the Sessions panel renders and the
// session-library `list_sessions` tool re-exposes (Slice ④ of the arc). One
// entry per CONVERSATION: a continuity chain (segments linked by
// `continuedFromSessionId`) collapses into a single entry whose identity is
// its newest segment — the user's mental model is one ongoing conversation,
// not a stack of "Continued conversation" rows. Dates are ISO strings on the
// wire. Live "working" status is deliberately NOT here — the activity feed is
// the one source of live truth; the UI marries the two.

export interface SessionsOverviewSegment {
  sessionId: string
  title: string
  startedAt: string
  lastMessageAt: string
  /** The segment's context occupancy when last active (null = never
   *  reported). For a superseded segment: the occupancy it forked at. */
  contextTokens: number | null
  continuedFromSessionId: string | null
  /** True for the segment a live primary conversation currently points at. */
  isCurrent: boolean
}

export interface SessionsOverviewEntry {
  /** The entry's open target — its newest segment's id. */
  sessionId: string
  scope: 'global' | 'workspace' | 'agent'
  workspaceId: string | null
  workspaceName: string | null
  title: string
  model: string | null
  /** The newest segment's occupancy — the meter's numerator. */
  contextTokens: number | null
  /** `resolveContextWindow(model)` — the meter's denominator. */
  contextWindow: number
  lastMessageAt: string
  /** Ordered oldest → newest; length 1 for an unswapped conversation. */
  segments: SessionsOverviewSegment[]
}
