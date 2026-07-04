// The one-time-schedule discriminator — the SINGLE home for "what makes a
// schedule fire once instead of on a cron."
//
// A schedule now carries an explicit `scheduleKind` column ('recurring' |
// 'one-time'). It was added under the zero-data single-baseline (a
// baseline-fold, no data migration) — so the populated-DB risk that once
// forced a sentinel-cron workaround (the lesson of migration 0029) never
// applied. `isOneTimeSchedule` is the one predicate over that column; every
// croner-parse site routes its decision through here.
//
// A one-time schedule fires once at its `nextScheduledFireAt`, then disarms
// (the poll's next-fire computation returns null for it, so it is never
// re-listed). It carries a NULL cron — a real cron belongs only to a recurring
// schedule.
//
// Cross-consumer (core fires it, api serializes it, web renders it), db-free —
// hence @vynel/contracts. Re-declared locally (not imported from the schema)
// to keep @vynel/contracts free of a @vynel/db dep — the sibling-enum
// precedent in `schedule-http.ts`.

export type ScheduleKind = 'recurring' | 'one-time'

export function isOneTimeSchedule(schedule: { scheduleKind: ScheduleKind }): boolean {
  return schedule.scheduleKind === 'one-time'
}
