// The SYSTEM-reporter convention (task-execution arc, 2026-08-18): a report
// delivery whose sender is not a session but VYNEL ITSELF — the task pickup
// nudge, a failed schedule run, a monitor wake. Each of those enqueues with a
// synthetic `reporterSessionId` of the form `<producer>:<id>`; this is the
// ONE reading of that convention, and it is LOAD-BEARING: the delivery tick
// stamps such rows `sourceKind: 'system'` (the UI's quiet-notification
// rendering) and swaps the report marker/steer for the system ones. Adding a
// producer prefix here without a matching enqueue (or vice versa) silently
// changes how its deliveries read — keep the list and the enqueue call sites
// in step.

const SYSTEM_REPORTER_PREFIXES = ['task:', 'schedule:', 'monitor:'] as const

export function isSystemReporterSessionId(reporterSessionId: string): boolean {
  return SYSTEM_REPORTER_PREFIXES.some((prefix) => reporterSessionId.startsWith(prefix))
}
