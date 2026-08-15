// The api-side `channels` service — the long-lived poll(5s) / process(1s) /
// deliver(2s) loops. Polling fetches inbound messages from each enabled channel's
// adapter and persists them; processing runs a GLOBAL-ROOT turn per pending inbound
// message and queues the answer back; delivery sends queued outbound messages via
// the adapter. Started from `server.ts` AFTER `createApp(...)` and stopped on
// shutdown (mirrors the schedules service).
//
// Lives in `apps/local-api`, NOT `apps/worker` (locked CHAN-1 / OQ-1 / D16+D17)
// for two reasons:
//   1. Sub-minute cadence — below node-cron's 1-min floor.
//   2. The processing turn is MCP-intrinsic — `runGlobalRootTurn` builds the
//      in-process Vynel MCP server from the api's own `app.request`, so it must
//      run in the api process.
//
// The processing pass fires each pending message as a CONCURRENT
// `processInboundMessage` (NOT awaited serially); the atomic claim inside guards
// double-dispatch. The turn deps inject `appRequest` + the global-root runner (which
// composes the MCP servers) + `resolveApproval`, so the channels LEAF never imports
// apps/local-api, @vynel/session, or the approvals leaf (invariant #2).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.8`.

import {
  runChannelPollingTick,
  runChannelDeliveryTick,
  processInboundMessage,
  listPendingInboundMessages,
  extractErrorMessage,
  type ProcessInboundDeps,
} from '@vynel/channels'
import { resolveApproval } from '@vynel/approvals'
import type { AiAgentProviderId } from '@vynel/providers'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { HonoAppRequestFn } from '../factory.js'
import type { PendingAskRegistry } from '@vynel/asks'
import type { ReadEnabledFeatureKeys } from '../sessions/enabled-feature-keys.js'
import { runGlobalRootTurn } from '../sessions/run-global-root-turn.js'
import type { TurnEventBroadcaster } from '@vynel/session/delegation'

const POLLING_INTERVAL_MS = 5_000
const DELIVERY_INTERVAL_MS = 2_000
const PROCESSING_INTERVAL_MS = 1_000
const PROCESSING_BATCH_LIMIT = 10

export interface ChannelsServiceOptions {
  db: Database
  logger: Logger
  /** From `createApp(...)` in server.ts (`app.request.bind(app)`) — the in-process
   *  dispatcher the processing turn's MCP server re-enters the api through. */
  appRequest: HonoAppRequestFn
  /** The shared turn-liveness registry — a channel turn announces itself so the
   *  open app goes live while it runs (shared with `createApp` via server.ts). */
  activityFeed: SessionActivityFeed
  /** The shared live-turn pub/sub — channel turns tee onto their session
   *  channel so they are watchable like any other (Slice ③). */
  turnEvents?: TurnEventBroadcaster
  /** The process-wide desktop-notification reader (server.ts, Windows only) —
   *  the channel root carries the brain's desktop senses too. */
  desktopReader?: unknown
  /** Whether the mutating desktop `act_on_app` tool is enabled (env flag). */
  enableDesktopActions?: boolean
  /** Per-composition entitlement read (tier filtering). Absent = fail-open. */
  readEnabledFeatureKeys?: ReadEnabledFeatureKeys
  /** The shared parked-ask registry — gives channel turns ask_user (bounded). */
  askWaiters?: PendingAskRegistry
}

export function startChannelsService(options: ChannelsServiceOptions): { stop: () => void } {
  const {
    db,
    logger,
    appRequest,
    activityFeed,
    turnEvents,
    desktopReader,
    enableDesktopActions,
    readEnabledFeatureKeys,
    askWaiters,
  } = options

  const turnDeps: ProcessInboundDeps = {
    logger,
    appRequest,
    // Ch4: a channel turn runs against the GLOBAL ROOT. `db` is per-call (the claim
    // path passes it); `logger` + `appRequest` are the service's. The runner
    // serializes root turns per user (the firehose lock lives in the core).
    runRootTurn: (turnDb, input) =>
      runGlobalRootTurn(
        {
          db: turnDb,
          logger,
          appRequest,
          activityFeed,
          ...(turnEvents !== undefined ? { turnEvents } : {}),
          desktopReader,
          ...(enableDesktopActions !== undefined ? { enableDesktopActions } : {}),
          ...(readEnabledFeatureKeys !== undefined ? { readEnabledFeatureKeys } : {}),
          ...(askWaiters !== undefined ? { askWaiters } : {}),
        },
        input,
      ),
    // KLONE decoupled the approvals leaf: `resolveApproval` is injected here (the
    // channels leaf never imports @vynel/approvals). The channel approval-reply path
    // passes a nullable `workspaceId` faithfully; the current resolve is user-scoped
    // (a global-root card has no workspace to name), so this adapter drops it. The
    // provider id widens to `AiAgentProviderId` at this single documented cast.
    resolveApproval: (turnDb, { providerApprovalId, userId, providerId, decision }, deps) =>
      resolveApproval(
        turnDb,
        { providerApprovalId, userId, providerId: providerId as AiAgentProviderId, decision },
        deps ?? {},
      ),
  }

  const pollTimer = setInterval(() => {
    runChannelPollingTick(db, { logger }).catch((err) =>
      logger.error({ error: extractErrorMessage(err) }, 'channel polling tick failed'),
    )
  }, POLLING_INTERVAL_MS)

  const deliverTimer = setInterval(() => {
    runChannelDeliveryTick(db, { logger }).catch((err) =>
      logger.error({ error: extractErrorMessage(err) }, 'channel delivery tick failed'),
    )
  }, DELIVERY_INTERVAL_MS)

  const processTimer = setInterval(() => {
    const pending = listPendingInboundMessages(db, { limit: PROCESSING_BATCH_LIMIT })
    // Fire each CONCURRENTLY — do NOT await serially. The atomic claim inside
    // `processInboundMessage` prevents double-dispatch of an in-flight turn.
    for (const message of pending) {
      processInboundMessage(db, { inboundMessageId: message.id }, turnDeps).catch((err) =>
        logger.error(
          { error: extractErrorMessage(err), inboundMessageId: message.id },
          'channel processing failed',
        ),
      )
    }
  }, PROCESSING_INTERVAL_MS)

  logger.info({}, 'channels service started (poll 5s / process 1s / deliver 2s)')

  return {
    stop: () => {
      clearInterval(pollTimer)
      clearInterval(deliverTimer)
      clearInterval(processTimer)
    },
  }
}
