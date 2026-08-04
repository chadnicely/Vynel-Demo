// `SessionActivityFeed` — the per-user liveness registry behind `GET
// /activity/stream`. Every turn producer (web/voice SSE streams, the channel
// runner, schedule fires) `begin()`s a turn here; any open UI surface
// `subscribe()`s and learns that a turn is running — including turns started
// by ANOTHER tab or by a Telegram message, which the tab's own turn stream can
// never see. Subscribing REPLAYS the in-flight turns as `turn-started` first
// (a tab opened mid-turn must not wait for the next event), then streams live.
//
// Fan-out rides the generic `TurnEventBroadcaster` (one home for the
// contained-listener semantics); this class adds the snapshot state the
// broadcaster deliberately doesn't keep. Genuinely stateful — the registry
// class exception. Phase 1 is one api process; the Phase-2 multi-process swap
// point is the reserved `pubsub` package, same as the trace broadcaster.

import type {
  SessionActivityEvent,
  SessionTurnActivity,
  SessionTurnOrigin,
  SessionTurnStep,
} from '@vynel/contracts/chat/session-activity'
import { TurnEventBroadcaster } from '../delegation/turn-event-broadcaster.js'

/** The feed channel one user's turns publish on. */
export function activityChannelKey(userId: string): string {
  return `activity:${userId}`
}

export interface BeginTurnActivityInput {
  userId: string
  scopeKind: 'global' | 'workspace'
  workspaceId?: string
  /** Known up front only for a resume; a fresh conversation resolves it mid-turn. */
  sessionId?: string
  origin: SessionTurnOrigin
  /** Correlation for the durable envelope + the live frames (persona-sessions)
   *  — the continuing identity, the queue row, the chain, the per-hop trace
   *  key. All optional; producers stamp what they know. */
  primarySessionId?: string
  jobId?: string
  threadId?: string
  partialSessionId?: string
  /** Display enrichment for the live frames (never stored): the delegated
   *  task's short label + the speaking persona's name. */
  taskLabel?: string
  personaName?: string
}

/** The durable-envelope seam (persona-sessions): every begin/resolve/end also
 *  lands in `session_turns` so a refresh/restart can rebuild the live picture.
 *  Implementations OWN their failure handling (log, never throw) — liveness
 *  must never die on a bookkeeping write. */
export interface SessionTurnRecorder {
  turnStarted: (turn: {
    turnId: string
    userId: string
    scopeKind: 'global' | 'workspace'
    workspaceId: string | null
    sessionId: string | null
    origin: SessionTurnOrigin
    startedAt: Date
    primarySessionId: string | null
    jobId: string | null
    threadId: string | null
    partialSessionId: string | null
  }) => void
  turnResolved: (turnId: string, sessionId: string) => void
  turnEnded: (turnId: string) => void
}

export interface SessionTurnActivityHandle {
  readonly turnId: string
  /** The runtime learned (or confirmed) the session this turn runs on. */
  sessionResolved: (sessionId: string) => void
  /** Publish one narration step (tool start/settle, approval bell) on the feed.
   *  Transient — stamped with this turn's id, never stored, no-op after end(). */
  publishTurnStep: (step: SessionTurnStep) => void
  /** The turn finished (drained, threw, or the client disconnected). Idempotent. */
  end: () => void
}

export class SessionActivityFeed {
  private readonly broadcaster = new TurnEventBroadcaster<SessionActivityEvent>()
  private readonly activeTurnsByUser = new Map<string, Map<string, SessionTurnActivity>>()
  // The LAST step per in-flight turn — replayed after `turn-started` on
  // subscribe so a mid-turn attach narrates immediately (persona-sessions).
  // Transient like the steps themselves; dropped on end.
  private readonly lastStepByTurnId = new Map<string, { turnId: string } & SessionTurnStep>()

  /** `turnRecorder` mirrors begin/resolve/end into the durable `session_turns`
   *  envelope (persona-sessions). Optional — test harnesses and the feed's own
   *  liveness need no DB. */
  constructor(private readonly deps: { turnRecorder?: SessionTurnRecorder } = {}) {}

  /** Register a turn + announce `turn-started`. The caller MUST `end()` in a
   *  finally — a leaked handle would keep listeners polling forever. */
  begin(input: BeginTurnActivityInput): SessionTurnActivityHandle {
    const startedAt = new Date()
    const turn: SessionTurnActivity = {
      turnId: crypto.randomUUID(),
      scopeKind: input.scopeKind,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      origin: input.origin,
      startedAt: startedAt.toISOString(),
      primarySessionId: input.primarySessionId ?? null,
      jobId: input.jobId ?? null,
      threadId: input.threadId ?? null,
      partialSessionId: input.partialSessionId ?? null,
      taskLabel: input.taskLabel ?? null,
      personaName: input.personaName ?? null,
    }
    const turns = this.activeTurnsByUser.get(input.userId) ?? new Map<string, SessionTurnActivity>()
    turns.set(turn.turnId, turn)
    this.activeTurnsByUser.set(input.userId, turns)
    this.broadcaster.publish(activityChannelKey(input.userId), { kind: 'turn-started', ...turn })
    this.deps.turnRecorder?.turnStarted({
      turnId: turn.turnId,
      userId: input.userId,
      scopeKind: input.scopeKind,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      origin: input.origin,
      startedAt,
      primarySessionId: input.primarySessionId ?? null,
      jobId: input.jobId ?? null,
      threadId: input.threadId ?? null,
      partialSessionId: input.partialSessionId ?? null,
    })

    let ended = false
    return {
      turnId: turn.turnId,
      sessionResolved: (sessionId: string) => {
        if (ended || turn.sessionId === sessionId) return
        turn.sessionId = sessionId
        this.broadcaster.publish(activityChannelKey(input.userId), {
          kind: 'turn-updated',
          turnId: turn.turnId,
          sessionId,
        })
        this.deps.turnRecorder?.turnResolved(turn.turnId, sessionId)
      },
      publishTurnStep: (step: SessionTurnStep) => {
        if (ended) return
        const frame = { turnId: turn.turnId, ...step }
        this.lastStepByTurnId.set(turn.turnId, frame)
        this.broadcaster.publish(activityChannelKey(input.userId), frame)
      },
      end: () => {
        if (ended) return
        ended = true
        turns.delete(turn.turnId)
        if (turns.size === 0) this.activeTurnsByUser.delete(input.userId)
        this.lastStepByTurnId.delete(turn.turnId)
        this.broadcaster.publish(activityChannelKey(input.userId), {
          kind: 'turn-ended',
          turnId: turn.turnId,
          sessionId: turn.sessionId,
        })
        this.deps.turnRecorder?.turnEnded(turn.turnId)
      },
    }
  }

  /** Attach a listener: the in-flight snapshot replays as `turn-started`
   *  frames — each followed by that turn's LAST step, so a mid-turn attach
   *  narrates immediately — then live events follow. Returns the unsubscribe. */
  subscribe(userId: string, onEvent: (event: SessionActivityEvent) => void): () => void {
    for (const turn of this.activeTurnsByUser.get(userId)?.values() ?? []) {
      onEvent({ kind: 'turn-started', ...turn })
      const lastStep = this.lastStepByTurnId.get(turn.turnId)
      if (lastStep !== undefined) onEvent(lastStep)
    }
    return this.broadcaster.subscribe(activityChannelKey(userId), {
      onEvent,
      // The feed never "ends" — turns end individually via `turn-ended`.
      onEnd: () => {},
    })
  }
}
