// The session-activity feed's wire vocabulary (`GET /activity/stream`). A
// lightweight LIVENESS signal — every turn the api runs (web, voice, or a
// channel's background root turn) announces start/identity/end so ANY open UI
// surface (a second tab, a thread a Telegram message just landed in) knows to
// go live. Deliberately NOT the token stream: the persisted rows advance under
// the turn (assistant text appends per chunk), so a listener that polls the
// session detail while a turn is active renders near-live text; token-level
// mirroring stays the trace-observe stream's job.

/** Where a turn came from — drives the "Claude is replying via …" indicator. */
export type SessionTurnOrigin =
  | 'web'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'schedule'

/** One in-flight turn as the feed reports it. `sessionId` is null until the
 *  runtime resolves it (a fresh conversation learns its id mid-turn). */
export interface SessionTurnActivity {
  turnId: string
  scopeKind: 'global' | 'workspace'
  workspaceId: string | null
  sessionId: string | null
  origin: SessionTurnOrigin
  startedAt: string
}

export type SessionActivityEvent =
  | ({ kind: 'turn-started' } & SessionTurnActivity)
  | { kind: 'turn-updated'; turnId: string; sessionId: string }
  | { kind: 'turn-ended'; turnId: string; sessionId: string | null }
