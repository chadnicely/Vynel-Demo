// `monitors` table for the `monitors` domain — one row per armed watch. A
// monitor is Claude's own standing interest in something happening: it arms a
// watch, keeps working, and when a matching event lands the OWNING session is
// woken with it. The Claude Code `Monitor` primitive, in Vynel's shape.
//
// WHY THIS IS CHEAP: every state change in Vynel already co-commits an outbox
// event (architecture invariant 5), so `outbox_events` IS the event bus — a
// monitor subscribes to types on it rather than needing producers to know
// monitors exist. And "wake a session with an inbound event" already ships
// three times over (channel message, schedule fire, report delivery), so
// firing reuses those queues rather than inventing a delivery path.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope — nullable, NULL = global (mirrors `plans.workspaceId`).
// `ownerSessionId` is a LOOSE `text()` cross-domain ref (NO FK — the spawned
// primary lives in the session leaf's table, the `plans.sessionId` precedent).
// Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, integer, json, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

/** How many times a match wakes the owner. `once` disarms on the first hit
 *  (Claude Code's "tell me when X happens"); `recurring` keeps firing until it
 *  expires or is stopped ("tell me every time X happens"). */
export type MonitorMode = 'once' | 'recurring'

/** `armed` is the only live state. `fired` is a spent `once` monitor, `stopped`
 *  was disarmed deliberately, `expired` outlived its deadline. All three are
 *  terminal — a monitor is never re-armed, a new one is created. */
export type MonitorStatus = 'armed' | 'fired' | 'stopped' | 'expired'

/** Which conversation gets woken. The three map 1:1 onto the three enqueue
 *  paths that already exist, which is what keeps firing free of new machinery. */
export type MonitorOwnerKind = 'global-root' | 'workspace-primary' | 'spawned-session'

export const monitors = table(
  'monitors',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // NULL = GLOBAL scope. `text().references(...)` since `id()` is NOT NULL.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text().$type<MonitorOwnerKind>().notNull(),
    // The spawned primary session to wake — set only for 'spawned-session'.
    // Loose ref, NOT a FK (cross-leaf).
    ownerSessionId: text(),
    // What Claude is watching, in its own words — carried into the wake message
    // so the woken turn knows why it was woken.
    description: text().notNull(),
    // The outbox types this monitor subscribes to. `json()` is for
    // opaque-never-filtered config; matching happens in the tick, in JS, after
    // a coarse type filter — never in SQL against this column.
    eventTypes: json<string[]>().notNull(),
    // Optional narrowing on the event payload: every entry must equal the
    // payload's field of the same name (e.g. { workspaceId, channelId }).
    // NULL = match on type alone.
    payloadFilter: json<Record<string, string>>(),
    mode: text().$type<MonitorMode>().notNull(),
    status: text().$type<MonitorStatus>().notNull(),
    // REQUIRED, not optional. An armed monitor with no deadline is a leak —
    // the same discipline `docs/module-notes/mcp-tool-hang-audit.md` applied to
    // every unbounded wait. The tick expires them.
    expiresAt: timestamp().notNull(),
    // The tick's per-monitor watermark: events at or before this have been
    // considered. Seeded to createdAt so a monitor never fires on history.
    lastCheckedAt: timestamp().notNull(),
    firedCount: integer().notNull(),
    lastFiredAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    // The tick's read: armed monitors, oldest watermark first.
    statusCheckedIdx: index('idx_monitors_status_checked').on(t.status, t.lastCheckedAt),
    // The list reads (both doors).
    userWorkspaceIdx: index('idx_monitors_user_workspace').on(t.userId, t.workspaceId),
    userStatusIdx: index('idx_monitors_user_status').on(t.userId, t.status),
  }),
)

export type Monitor = typeof monitors.$inferSelect
export type NewMonitor = typeof monitors.$inferInsert
