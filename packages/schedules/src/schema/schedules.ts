// `schedules` table for the `schedules` domain — one row per scheduled
// trigger (cron expression, prompt template, destination, enabled flag,
// cached next-fire time). Has NO `deletedAt`: `deleteSchedule`
// hard-deletes and cascades to `schedule_runs` (decisions.md D11).
//
// Spec: `docs/blueprints/schedules/blueprint.md §3.1`.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is
// the domain scope — nullable, NULL = global (no workspace). `channelId` is a
// LOOSE `text()` cross-domain ref (NO FK
// to channels — D7); the file does NOT import channels' schema. Indexes are
// declared via the `index()` helper in the second arg (never raw CREATE
// INDEX). Phase 1 SYNC repo discipline applies.

import { table, id, text, timestamp, boolean, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type ScheduleTemplateKind =
  | 'morning-briefing'
  | 'weekly-summary'
  | 'email-watch'
  | 'custom'
  | 'reminder'

export type ScheduleDestinationKind =
  | 'chat-only' // result lives only in the chat session
  | 'chat-and-channel' // result also delivered to a connected channel (via the outbox event)

// Discriminates a recurring schedule (fires on a cron) from a one-time one
// (fires once at `nextScheduledFireAt`, then disarms — carries no cron). The
// explicit column replaces the former `@once` sentinel; the single predicate
// `isOneTimeSchedule` (in @vynel/contracts) reads it.
export type ScheduleKind = 'recurring' | 'one-time'

export const schedules = table(
  'schedules',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: NULL = GLOBAL scope (a user-level schedule with no workspace);
    // a non-null value scopes the schedule to that workspace. Mirrors
    // `approval_requests.workspaceId` / `channels.workspaceId` (approvals
    // precedent). Uses `text().references(...)` since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    templateKind: text().$type<ScheduleTemplateKind>().notNull(),
    scheduleKind: text().$type<ScheduleKind>().notNull(), // 'recurring' | 'one-time'
    displayName: text().notNull(), // user-editable; defaults to the template label
    cronExpression: text(), // e.g. '0 9 * * MON'; NULL for a one-time schedule (fires by fireAt)
    timezone: text().notNull(), // IANA tz, e.g. 'America/Los_Angeles'
    promptTemplate: text().notNull(), // {{placeholders}} resolved at fire time
    destinationKind: text().$type<ScheduleDestinationKind>().notNull(),
    // Loose cross-domain ref — NOT a FK, and the file does NOT import
    // channels' schema. A deleted channel leaves a dangling id here; the
    // channels consumer drops it quietly (D7). Same treatment as
    // schedule_runs.chatSessionId.
    channelId: text(), // null if no channel destination
    catchUpOnMiss: boolean().notNull(),
    isEnabled: boolean().notNull(),
    approvalTimeoutMsOverride: integer(), // optional per-schedule approval timeout
    lastFiredAt: timestamp(), // most recent successful fire
    nextScheduledFireAt: timestamp(), // cached; advanced ONLY by the poll claim (§5.6)
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_schedules_user_workspace').on(t.userId, t.workspaceId),
    enabledNextFireIdx: index('idx_schedules_enabled_next_fire').on(
      t.isEnabled,
      t.nextScheduledFireAt,
    ),
  }),
)

export type Schedule = typeof schedules.$inferSelect
export type NewSchedule = typeof schedules.$inferInsert
