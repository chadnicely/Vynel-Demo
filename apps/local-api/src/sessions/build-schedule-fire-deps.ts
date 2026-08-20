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
// key a delegated job to that workspace takes AND the chat stream's
// continue-mode turn acquires) and runs under the delegated cap
// (`VYNEL_DELEGATED_TURN_MAX_MS`) on the streams' wall clock — suspended
// while a card is parked, interrupting the turn on expiry and failing the
// fire with the typed wall-clock error; a GLOBAL fire passes the same cap to
// the root runner, which arms it inside the root lock. The fire deps are built
// once per consumer — the boot poll service (`services/schedules-service.ts`)
// and the user-facing `fire-now` routes — so both drive the SAME machinery.
//
// Schedule-on-primary (Kafi, 2026-08-20 — deliberately reversing blueprint
// D3): a fired WORKSPACE turn runs ON the workspace's continuing conversation,
// like a delegated workspace turn and the user's own chat turn — the live
// 2026-08-20 fire ran "totally in background" because the fresh-session rule
// left the thread empty. The turn wrapper below resolves the primary inside
// the workspace lock and resumes its head; a first fire registers the primary
// and its fresh turn BECOMES the conversation, the way a first chat turn does.
//
// The MCP attachment comes from `buildWorkspaceBackgroundMcpComposer` — the ONE
// home for background workspace turns (shared with the delegation service), so
// every producer resuming a workspace's continuing conversation attaches the
// same server set (the deferred-tool "server disconnected" class).

import { renderScheduleFireMarker } from '@vynel/instructions/session-instructions'
import {
  composeSessionCapabilities,
  type SessionActivityFeed,
} from '@vynel/session/runtime'
import { findPrimaryConversation } from '@vynel/session/continuity'
import {
  resolveBackgroundTurnSettings,
  type SessionTargetLocks,
  type TurnEventBroadcaster,
} from '@vynel/session/delegation'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'
import { loadEnv } from '../env.js'
import { buildWorkspaceBackgroundMcpComposer } from './build-workspace-background-mcp.js'
import type { ReadEnabledFeatureKeys } from './enabled-feature-keys.js'
import { runGlobalRootTurn } from './run-global-root-turn.js'
import { buildFiredWorkspaceTurn } from './start-fired-workspace-turn.js'

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


export async function buildScheduleFireDeps(
  options: BuildScheduleFireDepsOptions,
): Promise<FireScheduleDeps> {
  const { appRequest, logger, activityFeed, targetLocks, turnEvents, readEnabledFeatureKeys } = options
  const env = loadEnv()
  const hardCapMs = options.hardCapMs ?? env.VYNEL_DELEGATED_TURN_MAX_MS
  // The swap threshold every continuity consumer honors (the env smoke knob) —
  // forwarded to BOTH the fit check and the boundary continuity step, so
  // "fits" and "will swap" never disagree on a fired turn either.
  const swapThreshold = env.VYNEL_CONTEXT_PRESSURE_THRESHOLD

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
  // else the one default. Since schedule-on-primary the fire RESUMES that head
  // (no more fresh session), so the head's occupancy rides the turn and the
  // row's model pick is fit-clamped like every other background pick that
  // resumes — a small-model pick over a fat chain would otherwise die with
  // "Prompt is too long" with nobody watching. No tool arg on a schedule, so
  // `job` is empty. (`startsFreshSession` stays available on the resolver for
  // a path that genuinely starts fresh; no fire path does any more.)
  const resolveWorkspaceTurnSettings: FireScheduleDeps['resolveWorkspaceTurnSettings'] = (
    turnDb,
    input,
  ) =>
    resolveBackgroundTurnSettings(turnDb, {
      headSdkSessionId:
        findPrimaryConversation(turnDb, { userId: input.userId, workspaceId: input.workspaceId })
          ?.currentSdkSessionId ?? null,
      job: { permissionMode: null, model: null, thinkingEffort: null },
      ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
      logger,
    })

  // BT3 — the fired WORKSPACE turn, bound to the shared registries;
  // `start-fired-workspace-turn.ts` owns what it does.
  const startBoundWorkspaceTurn = buildFiredWorkspaceTurn({
    logger,
    activityFeed,
    targetLocks,
    hardCapMs,
    ...(turnEvents !== undefined ? { turnEvents } : {}),
    ...(swapThreshold !== undefined ? { swapThreshold } : {}),
  })

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
    // only `session.id` / `message.sessionId` / `textDelta` / `errorMessage`
    // — present on both — so the single documented cast is runtime-safe.
    startChatTurn: startBoundWorkspaceTurn as unknown as FireScheduleDeps['startChatTurn'],
  }
}
