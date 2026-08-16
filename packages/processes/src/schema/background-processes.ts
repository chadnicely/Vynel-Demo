// `background_processes` table for the `processes` domain — one row per shell
// command a session ran in the background: the OS-process sibling of a
// delegated task. A session runs a command, keeps working (or ends its turn
// entirely), and when the process exits an outbox event fires — which the
// session's auto-armed monitor turns into a wake. The row is the durable
// record; the live child itself belongs to the in-memory runner and dies with
// the api process (the boot sweep settles what a crash left behind).
//
// OWNERSHIP mirrors `monitors`: the owner is the SESSION that ran the command,
// resolved ambiently at the route (caller header / scope) — never model input.
// `ownerSessionId` is a LOOSE text ref (the spawned primary lives in the
// session leaf's table; the `monitors.ownerSessionId` precedent).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope — nullable, NULL = global. Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import type { ProcessFailureReason } from '../processes-types.js'

/** `running` is the only live state. `succeeded` exited 0; `failed` covers a
 *  non-zero exit, a spawn failure, a kill, a timeout, and the boot sweep — the
 *  `failureReason` column says which. Both terminal states are final: a
 *  process is never re-run, a new one is started. */
export type BackgroundProcessStatus = 'running' | 'succeeded' | 'failed'

/** Which conversation the completion wake lands on — the same three shapes
 *  monitors deliver to, which is what makes the auto-armed monitor free. */
export type BackgroundProcessOwnerKind = 'global-root' | 'workspace-primary' | 'spawned-session'

export const backgroundProcesses = table(
  'background_processes',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // NULL = GLOBAL scope. `text().references(...)` since `id()` is NOT NULL.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text().$type<BackgroundProcessOwnerKind>().notNull(),
    // The spawned primary that ran it — set only for 'spawned-session'.
    // Loose ref, NOT a FK (cross-leaf).
    ownerSessionId: text(),
    command: text().notNull(),
    // WHERE it ran — resolved from the owner's ground at the route, containment
    // checked. One column, one reading (the delegation `workspacePath` rule).
    cwdPath: text().notNull(),
    status: text().$type<BackgroundProcessStatus>().notNull(),
    pid: integer(),
    exitCode: integer(),
    failureReason: text().$type<ProcessFailureReason>(),
    // The bounded output tail, persisted AT SETTLE from the runner's ring
    // buffer — while the row says `running`, the live tail is served from
    // memory instead. NULL until settle.
    outputTail: text(),
    // The runtime ceiling the runner enforces (the tool-hang-audit rule: no
    // unbounded anything — a background process with no deadline is a leak).
    timeoutMs: integer().notNull(),
    startedAt: timestamp().notNull(),
    finishedAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    // The list reads (workspace door + global door).
    userWorkspaceIdx: index('idx_background_processes_user_workspace').on(t.userId, t.workspaceId),
    // The concurrency cap + the boot sweep both read by status.
    userStatusIdx: index('idx_background_processes_user_status').on(t.userId, t.status),
    statusIdx: index('idx_background_processes_status').on(t.status),
  }),
)

export type BackgroundProcess = typeof backgroundProcesses.$inferSelect
export type NewBackgroundProcess = typeof backgroundProcesses.$inferInsert
