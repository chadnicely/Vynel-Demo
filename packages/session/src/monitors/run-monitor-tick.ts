// `runMonitorTick` — the half of the monitors feature that makes it real: it
// matches armed watches against the outbox and WAKES their owning session.
//
// Lives in the session tier, not in `@vynel/monitors`, because it composes two
// domains: the leaf decides WHETHER a monitor fires (its matcher + reads); the
// orchestration queues decide HOW an owner is woken. A leaf may not import a
// sibling leaf, and the session tier is the layer that already composes both
// (the delegation ticks are the precedent).
//
// PER PASS:
//   1. Expire deadlines FIRST, so an expired monitor can never fire.
//   2. Read armed monitors, oldest watermark first (bounded — one user cannot
//      starve the rest).
//   3. Per monitor, read its subscribed types in the half-open window
//      `(lastCheckedAt, tickStartedAt]`. Every event falls in exactly one
//      window: no ties, no duplicates, no gaps.
//   4. On a match: enqueue the wake, THEN record the fire. On no match: just
//      advance the watermark.
//
// THE ORDER IN STEP 4 IS LOAD-BEARING. Enqueue first: if the process dies
// between the two writes, the owner is woken by a monitor still marked armed —
// noise, and self-correcting. The inverse loses the wake entirely, leaving a
// monitor marked fired with nobody woken, which is indistinguishable from
// "nothing has happened yet" — the exact silence this feature exists to end.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  listOutboxEventsByTypesInWindow,
  OUTBOX_WINDOW_READ_MAX_LIMIT,
} from '@vynel/db/repositories/_shared'
import {
  findFirstMatch,
  listArmedMonitors,
  recordMonitorExpired,
  recordMonitorFired,
  advanceMonitorWatermark,
  type Monitor,
  type WatchableEvent,
} from '@vynel/monitors'
import { enqueueReportDelivery, enqueueSessionDelegation } from '@vynel/orchestration'
import { findWorkspaceById } from '@vynel/workspaces'
import * as primarySessionsRepository from '../repositories/index.js'

export interface RunMonitorTickDeps {
  /** Resolve a spawned session's run cwd from its grounding workspace. Injected
   *  because the one-home helper (`resolveSpawnedSessionRunCwd`, deleted-
   *  workspace fallback included) lives at the app tier — the
   *  `composeWorkspaceMcpServers` precedent. Takes the row the tick has ALREADY
   *  ownership-checked, so the resolver never re-queries and can never be handed
   *  a session this user does not own. */
  resolveSpawnedRunCwd?: (spawned: { workspaceId: string | null }) => string
  logger?: Logger
  now?: () => Date
  /** Bounds the monitors considered per pass. */
  limit?: number
}

export interface MonitorTickResult {
  expiredCount: number
  scannedCount: number
  firedCount: number
}

// One page of the windowed outbox scan = the shared read's own hard cap (one
// home — a drifted local copy would break short-page exhaustion detection).
const OUTBOX_SCAN_PAGE_SIZE = OUTBOX_WINDOW_READ_MAX_LIMIT

/** The payload as READABLE lines, never one JSON blob (live smoke,
 *  2026-08-17: a process wake dumped an escape-encoded outputTail as a
 *  single unreadable string). Scalars become `key: value` lines;
 *  multi-line strings (an output tail) render as a labeled block with
 *  REAL newlines, ordered last so the scalars stay scannable. */
function formatWakeDetails(payload: Record<string, unknown>): string {
  const scalars: string[] = []
  const blocks: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.includes('\n')) {
      blocks.push(`${key}:\n${value.trim()}`)
    } else {
      scalars.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    }
  }
  return [...scalars, ...blocks].join('\n')
}

/** Compose the wake message. It must stand alone: the woken turn has no idea
 *  why it started, so the monitor's own words and the event that matched are
 *  the entire context it gets. */
function composeWakeBody(monitor: Monitor, event: WatchableEvent): string {
  return [
    `A monitor you set has triggered: ${monitor.description}`,
    '',
    `What happened: ${event.type}`,
    formatWakeDetails(event.payload),
    '',
    monitor.mode === 'once'
      ? 'This was a one-time watch and is now spent.'
      : 'This watch stays armed and will trigger again.',
    'Act on it if it needs acting on; otherwise just absorb it. Do not re-verify what it reports.',
  ].join('\n')
}

export async function runMonitorTick(
  db: Database,
  deps: RunMonitorTickDeps = {},
): Promise<MonitorTickResult> {
  const now = (deps.now ?? (() => new Date()))()

  // Deadlines first — an expired watch must never fire on this same pass.
  const expired = recordMonitorExpired(db, { now }, { ...(deps.logger ? { logger: deps.logger } : {}) })

  const armed = listArmedMonitors(db, deps.limit)
  let firedCount = 0

  for (const monitor of armed) {
    // Scan the WHOLE window by paging the capped outbox read (session-review
    // B5): the old single read + advance-to-now silently skipped every event
    // past the cap — a matching event in the tail was lost forever, the exact
    // silence this feature exists to end. Keyset cursor ((createdAt, id)) so
    // boundary ties never drop a row between pages.
    let match: WatchableEvent | null = null
    let after = monitor.lastCheckedAt
    let afterId: string | undefined
    for (;;) {
      const events = listOutboxEventsByTypesInWindow(db, {
        types: monitor.eventTypes,
        after,
        through: now,
        ...(afterId !== undefined ? { afterId } : {}),
        limit: OUTBOX_SCAN_PAGE_SIZE,
      })
      match = findFirstMatch(
        monitor,
        events.map(
          (row): WatchableEvent => ({
            id: row.id,
            type: row.type,
            payload: row.payload,
            createdAt: row.createdAt,
          }),
        ),
      )
      if (match !== null || events.length < OUTBOX_SCAN_PAGE_SIZE) break
      const last = events[events.length - 1]!
      after = last.createdAt
      afterId = last.id
    }

    if (match === null) {
      advanceMonitorWatermark(db, { monitorId: monitor.id, checkedThrough: now, now })
      continue
    }

    let enqueuedJobId: string
    try {
      enqueuedJobId = enqueueMonitorWake(db, monitor, match, deps.resolveSpawnedRunCwd)
    } catch (err) {
      // The wake could not be queued — leave the monitor ARMED and the
      // watermark where it is, so the next pass retries the same event. Marking
      // it fired here would silently drop the very notification it exists for.
      deps.logger?.error(
        { err, monitorId: monitor.id, eventType: match.type },
        'monitor matched but the wake could not be enqueued — left armed for the next tick',
      )
      continue
    }

    recordMonitorFired(db, {
      monitor,
      matchedEventId: match.id,
      matchedEventType: match.type,
      enqueuedJobId,
      checkedThrough: now,
      firedAt: now,
    })
    firedCount += 1
    deps.logger?.info(
      { monitorId: monitor.id, eventType: match.type, jobId: enqueuedJobId },
      'monitor fired — the owning session has been woken',
    )
  }

  return { expiredCount: expired.length, scannedCount: armed.length, firedCount }
}

/** Wake the owner. The three kinds map 1:1 onto queues that already exist —
 *  which is what kept this feature from needing a delivery path of its own. */
function enqueueMonitorWake(
  db: Database,
  monitor: Monitor,
  event: WatchableEvent,
  resolveSpawnedRunCwd?: (spawned: { workspaceId: string | null }) => string,
): string {
  const body = composeWakeBody(monitor, event)
  // The wake is its own chain: a monitor is not a hop of some earlier task, it
  // is a new thing happening. Leaving threadId unset self-seeds one.
  const reporterLabel = `Monitor · ${monitor.description}`

  if (monitor.ownerKind === 'spawned-session') {
    const primary =
      monitor.ownerSessionId !== null
        ? primarySessionsRepository.findPrimarySessionById(db, monitor.ownerSessionId)
        : null
    if (primary === null || primary.userId !== monitor.userId) {
      throw new Error(
        `runMonitorTick: monitor ${monitor.id} targets session ${monitor.ownerSessionId ?? 'null'}, which is gone or not owned`,
      )
    }
    if (primary.currentSdkSessionId === null) {
      throw new Error(`runMonitorTick: session ${primary.id} has no linked conversation to wake`)
    }
    if (resolveSpawnedRunCwd === undefined) {
      // Fail loudly rather than guessing a cwd: running a session's turn in the
      // wrong directory is worse than not waking it, and the caller left the
      // dep out by mistake.
      throw new Error(
        'runMonitorTick: a spawned-session monitor fired but no resolveSpawnedRunCwd was injected',
      )
    }
    return enqueueSessionDelegation(db, {
      userId: monitor.userId,
      // The woken session is its own parent: a monitor has no delegating
      // conversation above it, and the row needs a non-empty provenance ref.
      parentSessionId: primary.currentSdkSessionId,
      targetPrimarySessionId: primary.id,
      runCwdPath: resolveSpawnedRunCwd(primary),
      taskText: body,
    })
  }

  if (monitor.ownerKind === 'workspace-primary' && monitor.workspaceId !== null) {
    const workspace = findWorkspaceById(db, monitor.workspaceId)
    // A deleted workspace falls through to the global root — upward chains
    // terminate there (the same missing-creator precedent the delegation tick
    // and report_to_requester both follow).
    if (workspace !== null) {
      return enqueueReportDelivery(db, {
        userId: monitor.userId,
        reporterSessionId: `monitor:${monitor.id}`,
        reporterLabel,
        reportBody: body,
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })
    }
  }

  return enqueueReportDelivery(db, {
    userId: monitor.userId,
    reporterSessionId: `monitor:${monitor.id}`,
    reporterLabel,
    reportBody: body,
    requester: { kind: 'global-root' },
  })
}
