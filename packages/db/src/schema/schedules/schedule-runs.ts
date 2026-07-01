// `schedule_runs` table for the `schedules` domain — one row per firing of
// a schedule (poll / catchup / manual). Child table: NO `userId` — scoped
// through `scheduleId -> schedules.userId` (the channels child-table
// precedent). `chatSessionId` is a LOOSE `text()` cross-system ref (NO FK to
// chat; the file does NOT import chat's schema). Cascade-deleted with its
// parent schedule (D11).
//
// Spec: `docs/blueprints/schedules/blueprint.md §3.2`.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { schedules } from './schedules.js'

export type ScheduleRunStatus =
  | 'pending' // row created; executor hasn't started the turn yet
  | 'running' // executor is running the turn
  | 'completed' // turn ended cleanly
  | 'failed' // turn errored
  | 'missed' // poll observed an overdue slot; catchUpOnMiss=false → recorded, not run

export type ScheduleRunTriggerKind =
  | 'poll' // normal: the per-minute poll claimed + fired it on time
  | 'catchup' // poll fired an overdue slot (catchUpOnMiss=true)
  | 'manual' // user hit "Run now"

export const scheduleRuns = table(
  'schedule_runs',
  {
    id: id().primaryKey(),
    scheduleId: id().references(() => schedules.id, { onDelete: 'cascade' }),
    scheduledFireAt: timestamp().notNull(), // when it was supposed to fire
    startedAt: timestamp().notNull(), // when it actually started
    completedAt: timestamp(),
    // Loose cross-system ref — NOT a FK to chatSessions.id, and the file does
    // NOT import chat's schema. The session belongs to the chat domain; a
    // real FK + cross-schema import would couple schedules to chat. Dangles
    // harmlessly if the chat session is later deleted (Phase 1 accepts
    // dangling cross-domain refs).
    chatSessionId: text(),
    status: text().$type<ScheduleRunStatus>().notNull(),
    statusMessage: text(),
    triggerKind: text().$type<ScheduleRunTriggerKind>().notNull(),
  },
  (t) => ({
    // The one growth-scaling history list (§6 GET /:scheduleId/runs) is
    // keyset-paginated on (scheduleId, startedAt DESC, id DESC).
    scheduleStartedIdx: index('idx_schedule_runs_schedule_started').on(
      t.scheduleId,
      t.startedAt,
      t.id,
    ),
    statusIdx: index('idx_schedule_runs_status').on(t.status),
  }),
)

export type ScheduleRun = typeof scheduleRuns.$inferSelect
export type NewScheduleRun = typeof scheduleRuns.$inferInsert
