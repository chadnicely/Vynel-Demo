// The api-side `channels` service — the long-lived poll(5s) / deliver(2s) loops
// that do NOT run a turn: polling fetches inbound messages from each enabled
// channel's adapter and persists them; delivery sends queued outbound messages
// via the adapter. Started from `server.ts` AFTER `createApp(...)` and stopped
// on shutdown (mirrors the schedules service).
//
// Lives in `apps/local-api`, NOT `apps/worker` (locked CHAN-1 / OQ-1 / D16+D17):
// sub-minute cadence is below node-cron's 1-min floor.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.8`.

// TODO(next): processing loop — needs the global-root turn edge. The inbound
// PROCESSING pass (the `processInboundMessage` setInterval that runs a
// global-root turn, built from the api's own `app.request` + injected
// `turnDeps`/`runRootTurn`) is a SEPARATE next task. Only the poll + deliver
// ticks — which need no turn machinery — are wired here.

import {
  runChannelPollingTick,
  runChannelDeliveryTick,
  extractErrorMessage,
} from '@vynel/channels'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const POLLING_INTERVAL_MS = 5_000
const DELIVERY_INTERVAL_MS = 2_000

export interface ChannelsServiceOptions {
  db: Database
  logger: Logger
}

export function startChannelsService(options: ChannelsServiceOptions): { stop: () => void } {
  const { db, logger } = options

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

  logger.info({}, 'channels service started (poll 5s / deliver 2s)')

  return {
    stop: () => {
      clearInterval(pollTimer)
      clearInterval(deliverTimer)
    },
  }
}
