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

  /** Register a turn + announce `turn-started`. The caller MUST `end()` in a
   *  finally — a leaked handle would keep listeners polling forever. */
  begin(input: BeginTurnActivityInput): SessionTurnActivityHandle {
    const turn: SessionTurnActivity = {
      turnId: crypto.randomUUID(),
      scopeKind: input.scopeKind,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      origin: input.origin,
      startedAt: new Date().toISOString(),
    }
    const turns = this.activeTurnsByUser.get(input.userId) ?? new Map<string, SessionTurnActivity>()
    turns.set(turn.turnId, turn)
    this.activeTurnsByUser.set(input.userId, turns)
    this.broadcaster.publish(activityChannelKey(input.userId), { kind: 'turn-started', ...turn })

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
      },
      publishTurnStep: (step: SessionTurnStep) => {
        if (ended) return
        this.broadcaster.publish(activityChannelKey(input.userId), {
          turnId: turn.turnId,
          ...step,
        })
      },
      end: () => {
        if (ended) return
        ended = true
        turns.delete(turn.turnId)
        if (turns.size === 0) this.activeTurnsByUser.delete(input.userId)
        this.broadcaster.publish(activityChannelKey(input.userId), {
          kind: 'turn-ended',
          turnId: turn.turnId,
          sessionId: turn.sessionId,
        })
      },
    }
  }

  /** Attach a listener: the in-flight snapshot replays as `turn-started` frames,
   *  then live events follow. Returns the unsubscribe. */
  subscribe(userId: string, onEvent: (event: SessionActivityEvent) => void): () => void {
    for (const turn of this.activeTurnsByUser.get(userId)?.values() ?? []) {
      onEvent({ kind: 'turn-started', ...turn })
    }
    return this.broadcaster.subscribe(activityChannelKey(userId), {
      onEvent,
      // The feed never "ends" — turns end individually via `turn-ended`.
      onEnd: () => {},
    })
  }
}
