// The session-activity feed's wire vocabulary (`GET /activity/stream`). A
// lightweight NARRATION signal — every turn the api runs (web, voice, or a
// channel's background root turn) announces start/identity/end, plus per-tool
// STEPS (name + small input + settle status) and approval BELLS, so ANY open UI
// surface (a second tab, the desktop-control overlay) knows to go live and what
// the turn is doing. Deliberately NOT the token stream: the persisted rows
// advance under the turn (assistant text appends per chunk), so a listener that
// polls the session detail while a turn is active renders near-live text;
// token-level mirroring stays the trace-observe stream's job. Steps are
// TRANSIENT — the subscribe-time snapshot replays `turn-started` only (a
// mid-turn attach narrates from now on), and approval bells carry no state:
// the approvals API stays the owner; a bell just says "refetch now".

/** Where a turn came from — drives the "Claude is replying via …" indicator.
 *  `'delegation'` = a background workspace turn running a task the assistant
 *  handed down (send_task_to_workspace); the originating channel stays on the
 *  job row — the feed reports what is running, not where it was asked from. */
export type SessionTurnOrigin =
  | 'web'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'schedule'
  | 'delegation'

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

/** A settled tool call's terminal status (mirrors the chat stream's vocabulary). */
export type SessionTurnStepStatus = 'completed' | 'failed' | 'denied' | 'cancelled'

/** One narration step inside a turn — published by the turn producer, stamped
 *  with the `turnId` by the feed. Transient: never part of the snapshot replay. */
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

export type SessionActivityEvent =
  | ({ kind: 'turn-started' } & SessionTurnActivity)
  | { kind: 'turn-updated'; turnId: string; sessionId: string }
  | ({ turnId: string } & SessionTurnStep)
  | { kind: 'turn-ended'; turnId: string; sessionId: string | null }
