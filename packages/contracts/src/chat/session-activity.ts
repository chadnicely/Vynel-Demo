// The session-activity feed's wire vocabulary (`GET /activity/stream`). A
// lightweight NARRATION signal — every turn the api runs (web, voice, or a
// channel's background root turn) announces start/identity/end, plus per-tool
// STEPS (name + small input + settle status) and approval BELLS, so ANY open UI
// surface (a second tab, the desktop-control overlay) knows to go live and what
// the turn is doing. Deliberately NOT the token stream: the persisted rows
// advance under the turn (assistant text appends per chunk), so a listener that
// polls the session detail while a turn is active renders near-live text;
// token-level mirroring stays the trace-observe stream's job. Steps are
// TRANSIENT — never stored — but the subscribe-time snapshot replays each
// in-flight turn's `turn-started` AND its LAST step (persona-sessions: a
// mid-turn attach should not narrate blank until the next tool call); approval
// bells carry no state: the approvals API stays the owner; a bell just says
// "refetch now".

/** Where a turn came from — drives the "Claude is replying via …" indicator.
 *  `'delegation'` = a background workspace turn running a task the assistant
 *  handed down (send_task_to_workspace); the originating channel stays on the
 *  job row — the feed reports what is running, not where it was asked from. */
export type SessionTurnOrigin =
  | 'web'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'zoom'
  | 'schedule'
  | 'delegation'

/** The identity family a live turn belongs to. `voice` was added by the
 *  session-hardening arc (2026-08-19): the spoken thread has its own primary
 *  and its own lock, so it must be its own vocabulary on the wire — a voice
 *  turn announcing as `global` made every reader infer identity from an
 *  absence and let the Global chat bind to the spoken segment. */
export type SessionTurnScopeKind = 'global' | 'workspace' | 'voice'

/** One in-flight turn as the feed reports it. `sessionId` is null until the
 *  runtime resolves it (a fresh conversation learns its id mid-turn). The
 *  persona-sessions fields are OPTIONAL enrichment — producers stamp what they
 *  know (delegated runs carry all of them; interactive turns few or none). */
export interface SessionTurnActivity {
  turnId: string
  scopeKind: SessionTurnScopeKind
  workspaceId: string | null
  sessionId: string | null
  origin: SessionTurnOrigin
  startedAt: string
  /** The continuing identity the turn runs on (a spawned/agent session id). */
  primarySessionId?: string | null
  /** The delegation queue row driving this turn. */
  jobId?: string | null
  /** The task chain this turn belongs to (the live card's key). */
  threadId?: string | null
  /** The per-hop trace key (the Watch drill's handle). */
  partialSessionId?: string | null
  /** The delegated task as a short label ("Set up the login page"). */
  taskLabel?: string | null
  /** Who is speaking this turn — the persona/agent/session display name. */
  personaName?: string | null
}

/** A settled tool call's terminal status (mirrors the chat stream's vocabulary). */
export type SessionTurnStepStatus = 'completed' | 'failed' | 'denied' | 'cancelled'

/** How a turn ended: 'failed' = the drain saw a terminal `session-errored` or
 *  threw (the workspace status vocabulary's "stuck on an error" signal); a
 *  user interrupt is a clean 'ended'. */
export type SessionTurnOutcome = 'ended' | 'failed'

/** One narration step inside a turn — published by the turn producer, stamped
 *  with the `turnId` by the feed. Transient (never stored) — the snapshot
 *  replays only each in-flight turn's LAST step, right after its
 *  `turn-started` frame. */
export type SessionTurnStep =
  | {
      kind: 'turn-tool-started'
      toolUseId: string
      toolName: string
      /** Omitted when the serialized input is large — step labels only need small inputs. */
      toolInput?: unknown
    }
  | { kind: 'turn-tool-settled'; toolUseId: string; status: SessionTurnStepStatus }
  | { kind: 'turn-approval-requested'; approvalRequestId: string; toolName: string }
  | { kind: 'turn-approval-resolved'; approvalRequestId: string }
  // The visible swap on the feed: the turn's conversation is being continued
  // on a fresh context (patching), then landed on `toSessionId` (null = the
  // swap aborted and the conversation stayed on `fromSessionId`).
  | { kind: 'turn-context-patching'; fromSessionId: string }
  | { kind: 'turn-context-patched'; fromSessionId: string; toSessionId: string | null }

export type SessionActivityEvent =
  | ({ kind: 'turn-started' } & SessionTurnActivity)
  | { kind: 'turn-updated'; turnId: string; sessionId: string }
  | ({ turnId: string } & SessionTurnStep)
  | { kind: 'turn-ended'; turnId: string; sessionId: string | null; outcome: SessionTurnOutcome }
