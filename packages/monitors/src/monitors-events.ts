// Outbox event type constants + payload interfaces for the `monitors` domain.
//
// Each event row is co-committed in the same sync `withTransaction(db, (tx) => …)`
// block as the state change via the `_shared/outbox` infra (architecture
// invariant: every state change co-commits its outbox event in ONE transaction).
//
// A NOTE ON REFLEXIVITY: these are outbox events like any other, so a monitor
// can subscribe to them — `monitor.fired` is legitimately watchable. The tick's
// own watermark is what stops that becoming a loop: a monitor never sees events
// older than its arming, so a monitor cannot observe its own firing, and two
// monitors watching each other still each advance past the other's event rather
// than re-reading it. Deliberate, not accidental.

import type { MonitorMode, MonitorOwnerKind } from './repositories/index.js'

export const MONITOR_ARMED = 'monitor.armed' as const
export const MONITOR_FIRED = 'monitor.fired' as const
export const MONITOR_STOPPED = 'monitor.stopped' as const
export const MONITOR_EXPIRED = 'monitor.expired' as const

export type MonitorArmedPayload = {
  monitorId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope
  ownerKind: MonitorOwnerKind
  eventTypes: string[]
  mode: MonitorMode
  expiresAt: string
  createdAt: string
}

export type MonitorFiredPayload = {
  monitorId: string
  userId: string
  workspaceId: string | null
  ownerKind: MonitorOwnerKind
  /** The outbox event that matched — the fact, not the payload (loose ref). */
  matchedEventId: string
  matchedEventType: string
  /** The wake this firing enqueued, so the chain is traceable end to end. */
  enqueuedJobId: string
  firedAt: string
}

export type MonitorStoppedPayload = {
  monitorId: string
  userId: string
  workspaceId: string | null
  stoppedAt: string
}

export type MonitorExpiredPayload = {
  monitorId: string
  userId: string
  workspaceId: string | null
  /** How many times it fired before expiring — 0 means it never matched. */
  firedCount: number
  expiredAt: string
}
