// Core op — arm a watch. sync. Insert + `monitor.armed` co-commit in ONE
// transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as monitorsRepository from '../repositories/index.js'
import { MONITOR_ARMED, type MonitorArmedPayload } from '../monitors-events.js'
import type { Database } from '@vynel/db'
import type { Monitor, MonitorMode, MonitorOwnerKind } from '../repositories/index.js'
import type { StructuralLogger } from '../monitors-types.js'

export const MONITOR_DESCRIPTION_MAX_LENGTH = 200
export const MONITOR_MAX_EVENT_TYPES = 20
export const MONITOR_MAX_FILTER_ENTRIES = 10

// A monitor MUST expire. The default is generous enough to span a working
// session and short enough that a forgotten watch dies on its own; the ceiling
// stops "arm it for a year" becoming a permanent background subscription
// nobody remembers arming. Same discipline as the tool-hang audit: no
// unbounded waits, anywhere.
export const MONITOR_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24h
export const MONITOR_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30d
const MONITOR_MIN_TTL_MS = 60_000 // 1m — below this it would expire before the tick sees it

export interface CreateMonitorInput {
  userId: string
  /** null = GLOBAL scope. Decides where the wake lands, not what may be watched. */
  workspaceId: string | null
  ownerKind: MonitorOwnerKind
  /** Required for `spawned-session`, rejected otherwise — a wake needs exactly
   *  one destination, and a stale id on a global monitor would be a silent trap. */
  ownerSessionId?: string | null
  description: string
  eventTypes: string[]
  payloadFilter?: Record<string, string> | null
  mode?: MonitorMode
  expiresInMs?: number
}

export function createMonitor(
  db: Database,
  input: CreateMonitorInput,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): Monitor {
  const description = input.description.trim()
  if (description.length === 0) {
    throw new ValidationError(
      'A monitor needs a description — say what you are watching for, e.g. "the billing migration finishing".',
    )
  }
  if (description.length > MONITOR_DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(
      `Monitor descriptions are capped at ${MONITOR_DESCRIPTION_MAX_LENGTH} characters.`,
    )
  }

  // Deduped so a repeated type can't inflate the row past the cap or make the
  // matcher do the same comparison twice.
  const eventTypes = [...new Set(input.eventTypes.map((type) => type.trim()).filter(Boolean))]
  if (eventTypes.length === 0) {
    throw new ValidationError(
      'A monitor needs at least one event type to watch. Call list_watchable_events to see what is available.',
    )
  }
  if (eventTypes.length > MONITOR_MAX_EVENT_TYPES) {
    throw new ValidationError(
      `A monitor can watch at most ${MONITOR_MAX_EVENT_TYPES} event types. Arm a second monitor for the rest.`,
    )
  }

  const payloadFilter = input.payloadFilter ?? null
  if (payloadFilter !== null && Object.keys(payloadFilter).length > MONITOR_MAX_FILTER_ENTRIES) {
    throw new ValidationError(
      `A monitor filter can carry at most ${MONITOR_MAX_FILTER_ENTRIES} fields.`,
    )
  }

  // One destination, always. A spawned-session monitor without its session id
  // could never be delivered; a global one carrying a session id would be
  // ambiguous about which of the two the tick should honour.
  const ownerSessionId = input.ownerSessionId ?? null
  if (input.ownerKind === 'spawned-session' && ownerSessionId === null) {
    throw new ValidationError('A spawned-session monitor must name the session to wake.')
  }
  if (input.ownerKind !== 'spawned-session' && ownerSessionId !== null) {
    throw new ValidationError('Only a spawned-session monitor carries a session id.')
  }

  const expiresInMs = input.expiresInMs ?? MONITOR_DEFAULT_TTL_MS
  if (expiresInMs < MONITOR_MIN_TTL_MS || expiresInMs > MONITOR_MAX_TTL_MS) {
    throw new ValidationError(
      `A monitor must expire between 1 minute and 30 days from now (got ${expiresInMs}ms).`,
    )
  }

  const now = (deps.now ?? (() => new Date()))()
  const monitor = withTransaction(db, (tx) => {
    const inserted = monitorsRepository.insertMonitor(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      ownerKind: input.ownerKind,
      ownerSessionId,
      description,
      eventTypes,
      payloadFilter,
      mode: input.mode ?? 'once',
      status: 'armed',
      expiresAt: new Date(now.getTime() + expiresInMs),
      // Seeded to NOW so a fresh monitor never fires on history — arming means
      // "from here on", which is what makes a watch a watch.
      lastCheckedAt: now,
      firedCount: 0,
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: MonitorArmedPayload = {
      monitorId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      ownerKind: inserted.ownerKind,
      eventTypes: inserted.eventTypes,
      mode: inserted.mode,
      expiresAt: inserted.expiresAt.toISOString(),
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MONITOR_ARMED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info(
    { monitorId: monitor.id, eventTypes: monitor.eventTypes, mode: monitor.mode },
    'monitor armed',
  )
  return monitor
}
