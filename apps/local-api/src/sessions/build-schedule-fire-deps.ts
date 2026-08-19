// Builds the `FireScheduleDeps` the schedules fire path (`fireSchedule` /
// `manualFireSchedule` / `runScheduleClaimAndFireTick`) runs against. This is
// the api-edge composition point: it binds the headless workspace turn
// (`startChatTurn`), the GLOBAL-ROOT turn a global schedule fires
// (`runGlobalRootTurn` — the runner channels use), the turn-settings resolver
// (`resolveBackgroundTurnSettings` — the delegated paths' rule), the
// per-workspace MCP attachment, and the capability PROMPT composition — the
// pieces the schedules LEAF declares only structurally so it never imports
// @vynel/mcp, @vynel/session, or the composer (invariant #2).
//
// Background-turns BT2/BT3 live here too: a fired WORKSPACE turn holds the
// workspace's single-writer key in the shared `SessionTargetLocks` (the SAME
// key a delegated job to that workspace takes) and runs under the delegated
// cap (`VYNEL_DELEGATED_TURN_MAX_MS`) on the streams' wall clock — suspended
// while a card is parked, interrupting the turn on expiry and failing the
// fire with the typed wall-clock error; a GLOBAL fire passes the same cap to
// the root runner, which arms it inside the root lock. The fire deps are built
// once per consumer — the boot poll service (`services/schedules-service.ts`)
// and the user-facing `fire-now` routes — so both drive the SAME machinery.
//
// The MCP attachment comes from `buildWorkspaceBackgroundMcpComposer` — the ONE
// home for background workspace turns (shared with the delegation service), so
// every producer resuming a workspace's continuing conversation attaches the
// same server set (the deferred-tool "server disconnected" class).

import { renderScheduleFireMarker } from '@vynel/instructions/session-instructions'
import { ApprovalWaitGate } from '@vynel/orchestration'
import {
  startChatTurn,
  composeSessionCapabilities,
  publishTurnActivityStep,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  type SessionActivityFeed,
  type TurnWallClockFailure,
} from '@vynel/session/runtime'
import { findPrimaryConversation } from '@vynel/session/continuity'
import {
  resolveBackgroundTurnSettings,
  type SessionTargetLocks,
  type TurnEventBroadcaster,
} from '@vynel/session/delegation'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'
import { loadEnv } from '../env.js'
import { buildWorkspaceBackgroundMcpComposer } from './build-workspace-background-mcp.js'
import type { ReadEnabledFeatureKeys } from './enabled-feature-keys.js'
import { runGlobalRootTurn, TurnWallClockExceededError } from './run-global-root-turn.js'

export interface BuildScheduleFireDepsOptions {
  /** The in-process dispatcher (`app.request.bind(app)`) each fired turn's MCP server re-enters the api through. */
  appRequest: HonoAppRequestFn
  logger: Logger
  /** The shared turn-liveness registry — every fired turn announces itself. */
  activityFeed: SessionActivityFeed
  /** The process-wide single-writer lock per target, SHARED with the
   *  delegation pool and the session-turn route: a fired workspace turn holds
   *  the workspace key for its whole run, so it never writes the workspace
   *  concurrently with a delegated run or a user turn. REQUIRED — a private
   *  registry here would serialize fires only among themselves. */
  targetLocks: SessionTargetLocks
  /** The shared live-turn pub/sub — fired turns tee onto their session channel. */
  turnEvents?: TurnEventBroadcaster
  /** Per-composition entitlement read (tier filtering). Absent = fail-open. */
  readEnabledFeatureKeys?: ReadEnabledFeatureKeys
  /** The cap on one fired turn's WORKING time (ms). Omit = `VYNEL_DELEGATED_TURN_MAX_MS`. */
  hardCapMs?: number
}

// The leaf's structural turn input, widened onto the runtime's: the leaf
// passes the run id (the bound's log key) beside the runtime fields.
type FiredWorkspaceTurnInput = Parameters<typeof startChatTurn>[1] & { scheduleRunId: string }

export async function buildScheduleFireDeps(
  options: BuildScheduleFireDepsOptions,
): Promise<FireScheduleDeps> {
  const { appRequest, logger, activityFeed, targetLocks, turnEvents, readEnabledFeatureKeys } = options
  const hardCapMs = options.hardCapMs ?? loadEnv().VYNEL_DELEGATED_TURN_MAX_MS

  // The shared background composer closes over the in-process `appRequest`
  // dispatcher so each fired turn re-enters the api (dynamic MCP import inside).
  const backgroundComposer = await buildWorkspaceBackgroundMcpComposer(
    appRequest,
    readEnabledFeatureKeys,
  )
  // The schedules contract stays surface-agnostic; a fired turn IS the
  // 'schedule' consumer kind, stamped here at the binding.
  const composeWorkspaceMcpServers: FireScheduleDeps['composeWorkspaceMcpServers'] = (input) =>
    backgroundComposer({ ...input, surfaceKind: 'schedule' })

  // BT2 — the settings a fired workspace turn runs under: what the user chose
  // for that workspace's continuing conversation (its primary's head row),
  // else the one default. The head is read for the ROW only: a schedule fire
  // starts a FRESH session (blueprint D3), so none of the head's occupancy
  // rides it and the row's model pick needs no fit clamp — clamping would
  // swap the user's small-model pick for the chain's big one over context the
  // new session does not carry. No tool arg on a schedule, so `job` is empty.
  const resolveWorkspaceTurnSettings: FireScheduleDeps['resolveWorkspaceTurnSettings'] = (
    turnDb,
    input,
  ) =>
    resolveBackgroundTurnSettings(turnDb, {
      headSdkSessionId:
        findPrimaryConversation(turnDb, { userId: input.userId, workspaceId: input.workspaceId })
          ?.currentSdkSessionId ?? null,
      startsFreshSession: true,
      job: { permissionMode: null, model: null, thinkingEffort: null },
      logger,
    })

  // BT3 — the fired WORKSPACE turn: the workspace lock, the delegated cap on
  // the streams' wall clock, the activity announce, and the turn's stream.
  // A fired turn mutates a workspace thread the user may have OPEN, with no
  // other signal — it announces on the session-activity feed like every other
  // turn producer, so the open thread goes live while the schedule runs.
  const startBoundWorkspaceTurn = async function* (
    turnDb: Database,
    input: FiredWorkspaceTurnInput,
    turnDeps: Parameters<typeof startChatTurn>[2] = {},
  ): ReturnType<typeof startChatTurn> {
    const { scheduleRunId, ...turnInput } = input
    if (turnInput.workspaceId === null) {
      throw new Error('schedule fire: a fired workspace turn needs a workspace id')
    }
    // The workspace's single-writer key — the SAME key a delegated job to this
    // workspace holds (`targetPrimarySessionId ?? workspaceId`). A busy key
    // parks this fire FIFO behind the holder (the session-turn route's rule),
    // never alongside it.
    const releaseLock = await targetLocks.acquire(turnInput.workspaceId)
    // The cap arms only now that the turn HOLDS its lock — queue time was the
    // holder's budget, not this turn's (the interactive streams' rule). A
    // parked card suspends it; on expiry the streams' helper interrupts the
    // running session (the provider ends the stream) and the fire fails with
    // the typed wall-clock error once the stream has settled.
    const waitGate = new ApprovalWaitGate()
    const approvalParks = trackApprovalParks(waitGate)
    let runningSessionId: string | undefined
    // A ref, not a `let`: the expiry lands inside the clock's callback, and
    // the post-stream read below must see it.
    const cap: { failure: Promise<TurnWallClockFailure> | null } = { failure: null }
    const wallClock = startTurnWallClock({
      maxMs: hardCapMs,
      waitGate,
      logger,
      onExpire: async () => {
        logger.warn(
          { scheduleRunId, workspaceId: turnInput.workspaceId, hardCapMs },
          'schedule fire: the fired turn exceeded its cap — interrupting it',
        )
        cap.failure = failTurnOnWallClock(
          { db: turnDb, logger },
          { sessionId: runningSessionId, maxMs: hardCapMs },
        )
        await cap.failure
      },
    })
    const activity = activityFeed.begin({
      userId: turnInput.userId,
      scopeKind: 'workspace',
      workspaceId: turnInput.workspaceId,
      origin: 'schedule',
    })
    // 'failed' on a terminal session-errored, a thrown drain, or the cap —
    // the status vocabulary's problem signal (a schedule fire has no other witness).
    let turnOutcome: 'ended' | 'failed' = 'ended'
    try {
      for await (const event of startChatTurn(turnDb, turnInput, {
        ...turnDeps,
        ...(turnEvents !== undefined ? { turnEvents } : {}),
      })) {
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
      releaseLock()
    }
  }

  // BT1 — a GLOBAL schedule fires a GLOBAL-ROOT turn: the rendered prompt is
  // the user message on the user's global conversation, through the same
  // runner channels use. The runner holds the per-user root lock itself and
  // arms the cap inside it (`wallClock` — the delegated knob here, where the
  // channels pass the interactive one), announcing on the feed as a schedule.
  // The fire FRAME (schedule-fire framing) maps onto the runner's existing
  // seams: the marker rides the per-message marker slot (provider input only),
  // the row is attributed to the schedule as a system notice, and the explicit
  // `autoContinue` keeps the fire a WORK turn — attribution alone would demote
  // it to a delivery turn.
  const startGlobalRootTurn: FireScheduleDeps['startGlobalRootTurn'] = async (turnDb, input) =>
    runGlobalRootTurn(
      {
        db: turnDb,
        logger,
        appRequest,
        activityFeed,
        ...(turnEvents !== undefined ? { turnEvents } : {}),
        ...(readEnabledFeatureKeys !== undefined ? { readEnabledFeatureKeys } : {}),
      },
      {
        userId: input.userId,
        userMessageText: input.userMessageText,
        channelReplyMarker: input.frame.marker,
        inboundAttribution: { sourceKind: 'system', sourceLabel: input.frame.sourceLabel },
        autoContinue: true,
        activityOrigin: 'schedule',
        wallClock: { maxMs: hardCapMs },
        ...(input.onSessionResolved !== undefined
          ? { onSessionResolved: input.onSessionResolved }
          : {}),
      },
    )

  return {
    logger,
    composeWorkspaceMcpServers,
    composeSessionCapabilities,
    resolveWorkspaceTurnSettings,
    startGlobalRootTurn,
    // The fire marker's words + placeholders live with the instruction file
    // (@vynel/instructions) — the leaf composes the frame but must not import
    // a sibling leaf, so the renderer is handed in here.
    renderScheduleFireMarker,
    // The session runtime's `startChatTurn` yields the RUNTIME `ChatTurnEvent`
    // (Date timestamps, `ChatSession` rows) and takes the narrower provider
    // mode / provider id types; `FireScheduleDeps['startChatTurn']` is typed
    // against the contracts WIRE union with plain strings. The fire path reads
    // only `session.id` / `textDelta` / `errorMessage` — present on both — so
    // the single documented cast is runtime-safe.
    startChatTurn: startBoundWorkspaceTurn as unknown as FireScheduleDeps['startChatTurn'],
  }
}
