// The BT3 half of the schedules fire path: ONE fired WORKSPACE turn, bound to
// the process-wide registries its owner shares. Lifted out of
// `build-schedule-fire-deps.ts` — that file BINDS the leaf's structural deps
// (the global runner, the settings resolver, the MCP + prompt composition);
// this one IS the turn: take the workspace's single-writer key, resolve the
// continuing conversation inside it, arm the wall clock, announce on the feed,
// and drain `startChatTurn`.

import { ApprovalWaitGate } from '@vynel/orchestration'
import {
  startChatTurn,
  publishTurnActivityStep,
  resolvePrimaryConversationTarget,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  type SessionActivityFeed,
  type TurnWallClockFailure,
} from '@vynel/session/runtime'
import type { SessionTargetLocks, TurnEventBroadcaster } from '@vynel/session/delegation'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { TurnWallClockExceededError } from './run-global-root-turn.js'

// The leaf's structural turn input, widened onto the runtime's: the leaf
// passes the run id (the bound's log key) beside the runtime fields.
export type FiredWorkspaceTurnInput = Parameters<typeof startChatTurn>[1] & {
  scheduleRunId: string
}

export interface FiredWorkspaceTurnOptions {
  logger: Logger
  /** The shared turn-liveness registry — every fired turn announces itself. */
  activityFeed: SessionActivityFeed
  /** The process-wide single-writer lock per target, SHARED with the delegation
   *  pool and the session-turn route. */
  targetLocks: SessionTargetLocks
  /** The shared live-turn pub/sub — fired turns tee onto their session channel. */
  turnEvents?: TurnEventBroadcaster
  /** The cap on one fired turn's WORKING time (ms). */
  hardCapMs: number
  /** The pressure threshold every continuity consumer honors (the env knob). */
  swapThreshold?: number
}

// BT3 — the fired WORKSPACE turn: the workspace lock, the delegated cap on
// the streams' wall clock, the activity announce, and the turn's stream —
// resumed onto the workspace's continuing conversation (schedule-on-primary).
// The fire RUNS ON the thread the user may have OPEN: the feed frame names
// the continuing identity (the rail's named conversation chip) and the
// turn's events tee onto the head's `session:<id>` channel (the shared
// `turnEvents`) — the same live path a delegated workspace turn lights the
// open thread through.
export function buildFiredWorkspaceTurn(options: FiredWorkspaceTurnOptions) {
  const { logger, activityFeed, targetLocks, turnEvents, hardCapMs, swapThreshold } = options

  return async function* startFiredWorkspaceTurn(
    turnDb: Database,
    input: FiredWorkspaceTurnInput,
    turnDeps: Parameters<typeof startChatTurn>[2] = {},
  ): ReturnType<typeof startChatTurn> {
    const { scheduleRunId, ...turnInput } = input
    if (turnInput.workspaceId === null) {
      throw new Error('schedule fire: a fired workspace turn needs a workspace id')
    }
    const workspaceId = turnInput.workspaceId
    // The workspace's single-writer key — the SAME key a delegated job to this
    // workspace holds AND the chat stream's continue-mode turn acquires
    // (`streams/chat-turn.ts`), so a fire can never interleave with a user
    // turn on the same conversation. A busy key parks this fire FIFO behind
    // the holder (the session-turn route's rule), never alongside it.
    const releaseLock = await targetLocks.acquire(workspaceId)
    try {
      // The continuing conversation, resolved INSIDE the lock (the interactive
      // stream's rule): the holder we queued behind can pressure-swap the
      // primary onto a fresh segment — the fire must resume THAT head, never a
      // pre-wait read. First fire on a workspace with no conversation yet:
      // get-or-create registers the primary (db-first, the continuity arc) and
      // the fresh turn becomes the conversation via the boundary link.
      const target = await resolvePrimaryConversationTarget(turnDb, {
        userId: turnInput.userId,
        workspaceId,
      })
      // The cap arms only now that the turn HOLDS its lock — queue time was the
      // holder's budget, not this turn's (the interactive streams' rule). A
      // parked card suspends it; on expiry the streams' helper interrupts the
      // running session (the provider ends the stream) and the fire fails with
      // the typed wall-clock error once the stream has settled.
      const waitGate = new ApprovalWaitGate()
      const approvalParks = trackApprovalParks(waitGate)
      let runningSessionId: string | undefined = target.resumeSdkSessionId ?? undefined
      // A ref, not a `let`: the expiry lands inside the clock's callback, and
      // the post-stream read below must see it.
      const cap: { failure: Promise<TurnWallClockFailure> | null } = { failure: null }
      const wallClock = startTurnWallClock({
        maxMs: hardCapMs,
        waitGate,
        logger,
        onExpire: async () => {
          logger.warn(
            { scheduleRunId, workspaceId, hardCapMs },
            'schedule fire: the fired turn exceeded its cap — interrupting it',
          )
          cap.failure = failTurnOnWallClock(
            { db: turnDb, logger },
            { sessionId: runningSessionId, maxMs: hardCapMs },
          )
          await cap.failure
        },
      })
      // The frame names the CONTINUING identity beside origin 'schedule' (the
      // rail's named conversation chip, opening the live thread); the head
      // rides along when known up front (a fresh one resolves mid-turn).
      const activity = activityFeed.begin({
        userId: turnInput.userId,
        scopeKind: 'workspace',
        workspaceId,
        origin: 'schedule',
        primarySessionId: target.primarySessionId,
        ...(target.resumeSdkSessionId !== null ? { sessionId: target.resumeSdkSessionId } : {}),
      })
      // 'failed' on a terminal session-errored, a thrown drain, or the cap —
      // the status vocabulary's problem signal (a schedule fire has no other witness).
      let turnOutcome: 'ended' | 'failed' = 'ended'
      try {
        for await (const event of startChatTurn(
          turnDb,
          {
            ...turnInput,
            // Resume the continuing conversation's head; omitted on a first
            // fire (fresh session, the first chat turn's path). The continuity
            // input turns the boundary step on — link on a fresh segment,
            // measure + seed-fresh swap at pressure — inside the lock hold.
            ...(target.resumeSdkSessionId !== null
              ? { resumeSessionId: target.resumeSdkSessionId }
              : {}),
            continuity: {
              primarySessionId: target.primarySessionId,
              ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
            },
          },
          {
            ...turnDeps,
            ...(turnEvents !== undefined ? { turnEvents } : {}),
          },
        )) {
          approvalParks.onTurnEvent(event)
          if (event.kind === 'session-errored' && !event.isRecoverable) turnOutcome = 'failed'
          if (event.kind === 'session-created') {
            runningSessionId = event.session.id
            activity.sessionResolved(event.session.id)
          } else if (event.kind === 'user-message-persisted') {
            runningSessionId = event.message.sessionId
            activity.sessionResolved(event.message.sessionId)
          }
          // Narrate tool steps + approval bells on the feed, like every producer.
          publishTurnActivityStep(activity, event)
          yield event
        }
        // A capped turn settled (interrupted, or it outran the interrupt) — the
        // honest outcome is the cap, whatever the stream produced.
        if (cap.failure !== null) throw new TurnWallClockExceededError(await cap.failure)
      } catch (err) {
        turnOutcome = 'failed'
        // The interrupt ends the stream CLEANLY (`session-interrupted`, no
        // throw) — the post-stream check above is the cap's normal exit. A throw
        // that lands while the cap is firing is something else racing it (a
        // provider error, a drain failure); the cap stays the honest outcome.
        if (cap.failure !== null && !(err instanceof TurnWallClockExceededError)) {
          throw new TurnWallClockExceededError(await cap.failure)
        }
        throw err
      } finally {
        wallClock.clear()
        activity.end(turnOutcome)
      }
    } finally {
      // Every exit — the resolve throwing, a clean drain, a cap failure — MUST
      // pass through this release, or the workspace key leaks and the
      // delegation pool + every continue-turn park on this workspace forever.
      releaseLock()
    }
  }
}
