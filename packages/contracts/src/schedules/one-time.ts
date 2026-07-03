// The one-time-schedule discriminator — the SINGLE home for "what makes a
// schedule fire once instead of on a cron."
//
// Phase 1 deliberately has NO `scheduleKind` column: adding one means a schema
// migration, and a migration can only be trusted once it's run against the
// owner's populated dev DB (the lesson of migration 0029 — an empty-DB test
// suite missed a populated-DB failure). So a one-time schedule is marked by a
// SENTINEL cron expression instead. When a `scheduleKind` column is added
// (attended, verified on real data), only this predicate changes — every
// croner-parse site already routes its decision through here.
//
// Cross-consumer (core fires it, api serializes it, web renders it), db-free —
// hence @vynel/contracts.

// A one-time schedule fires once at its `nextScheduledFireAt`, then disarms
// (the poll's next-fire computation returns null for it, so it is never
// re-listed). It carries this sentinel instead of a real cron. Every
// croner-parse site guards on `isOneTimeSchedule` BEFORE parsing, so the
// sentinel is never handed to croner. (Defense in depth: even if it were,
// croner rejects it → next-fire becomes null → the schedule disarms, which is
// exactly the one-time outcome.)
export const ONE_TIME_CRON_SENTINEL = '@once'

export function isOneTimeSchedule(schedule: { cronExpression: string }): boolean {
  return schedule.cronExpression === ONE_TIME_CRON_SENTINEL
}
