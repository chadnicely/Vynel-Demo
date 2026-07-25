// Public surface of `@vynel/monitors` — the monitors leaf. Consumers reach the
// package only through this barrel; schema, repositories and the concern
// folders are internal (imported relatively).
//
// What a monitor IS: Claude's own standing interest in something happening. It
// arms a watch, keeps working, and when a matching outbox event lands the
// OWNING session is woken with it. Per-session by design — global, workspace,
// or spawned — because in Vynel everything is a session.

export type { StructuralLogger, WatchableEvent } from './monitors-types.js'

// Row + union types — the HTTP serializers type their inputs against these
// (the plans `Plan` re-export precedent). Repositories stay internal.
export type {
  Monitor,
  MonitorMode,
  MonitorStatus,
  MonitorOwnerKind,
} from './repositories/index.js'

export {
  MONITOR_ARMED,
  MONITOR_FIRED,
  MONITOR_STOPPED,
  MONITOR_EXPIRED,
  type MonitorArmedPayload,
  type MonitorFiredPayload,
  type MonitorStoppedPayload,
  type MonitorExpiredPayload,
} from './monitors-events.js'

export {
  createMonitor,
  type CreateMonitorInput,
  MONITOR_DESCRIPTION_MAX_LENGTH,
  MONITOR_MAX_EVENT_TYPES,
  MONITOR_MAX_FILTER_ENTRIES,
  MONITOR_DEFAULT_TTL_MS,
  MONITOR_MAX_TTL_MS,
} from './lifecycle/create-monitor.js'
export { stopMonitor } from './lifecycle/stop-monitor.js'
export { listMonitors, listMonitorsForUser } from './queries/list-monitors.js'

// The matcher + the tick's reads — the app-tier monitor service composes these
// with the enqueue paths it owns (the delegation-service precedent: this leaf
// decides WHETHER a monitor fires; the app tier decides HOW the owner is woken,
// because those queues live outside this leaf).
export { matchesMonitor, findFirstMatch } from './firing/match-monitor-to-event.js'
export {
  listArmedMonitors,
  expireArmedMonitorsDueBy,
  findMonitorById,
} from './repositories/index.js'
export { recordMonitorFired } from './firing/record-monitor-fired.js'
export { recordMonitorExpired } from './firing/record-monitor-expired.js'
export { advanceMonitorWatermark } from './firing/advance-monitor-watermark.js'
