// Functional repository for the `monitors` table. `db` is the first argument;
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { monitors, type Monitor, type NewMonitor, type MonitorStatus } from '../schema/monitors.js'

export type {
  Monitor,
  NewMonitor,
  MonitorStatus,
  MonitorMode,
  MonitorOwnerKind,
} from '../schema/monitors.js'

// A session's armed watches are few by design; cap defensively anyway.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

// The tick's batch size. Bounded so one tick can't stall on a user who armed
// hundreds — the rest are picked up on the next pass (oldest watermark first,
// so nothing starves).
const TICK_SCAN_LIMIT = 200

export function insertMonitor(db: Database, row: NewMonitor): Monitor {
  const [inserted] = db.insert(monitors).values(row).returning().all()
  if (!inserted) throw new Error('insertMonitor: no row returned')
  return inserted
}

export function findMonitorById(db: Database, id: string): Monitor | null {
  const [row] = db.select().from(monitors).where(eq(monitors.id, id)).limit(1).all()
  return row ?? null
}

/** A workspace's monitors — the agent door's list. */
export function listMonitorsForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string; status?: MonitorStatus; limit?: number },
): Monitor[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(monitors.userId, input.userId), eq(monitors.workspaceId, input.workspaceId)]
  if (input.status) filters.push(eq(monitors.status, input.status))
  return db
    .select()
    .from(monitors)
    .where(and(...filters))
    .orderBy(desc(monitors.createdAt), desc(monitors.id))
    .limit(limit)
    .all()
}

/** The GLOBAL scope's monitors — workspaceId IS NULL, never "all of the
 *  user's". The strict-scope-visibility rule the channels UI settled: a global
 *  list shows global rows only. */
export function listGlobalMonitorsForUser(
  db: Database,
  input: { userId: string; status?: MonitorStatus; limit?: number },
): Monitor[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(monitors.userId, input.userId), isNull(monitors.workspaceId)]
  if (input.status) filters.push(eq(monitors.status, input.status))
  return db
    .select()
    .from(monitors)
    .where(and(...filters))
    .orderBy(desc(monitors.createdAt), desc(monitors.id))
    .limit(limit)
    .all()
}

/** Every armed monitor, oldest watermark first — the tick's read. Not
 *  user-scoped: the tick runs for the whole process and narrows per row. */
export function listArmedMonitors(db: Database, limit?: number): Monitor[] {
  return db
    .select()
    .from(monitors)
    .where(eq(monitors.status, 'armed'))
    .orderBy(asc(monitors.lastCheckedAt), asc(monitors.id))
    .limit(Math.min(limit ?? TICK_SCAN_LIMIT, TICK_SCAN_LIMIT))
    .all()
}

export function updateMonitor(
  db: Database,
  id: string,
  patch: Partial<
    Pick<
      Monitor,
      'status' | 'lastCheckedAt' | 'firedCount' | 'lastFiredAt' | 'updatedAt'
    >
  >,
): Monitor {
  const [updated] = db.update(monitors).set(patch).where(eq(monitors.id, id)).returning().all()
  if (!updated) throw new Error(`updateMonitor: monitor ${id} not found`)
  return updated
}

/** Expire every armed monitor past its deadline. Returns the rows expired so
 *  the caller can log/announce them. */
export function expireArmedMonitorsDueBy(db: Database, now: Date): Monitor[] {
  return db
    .update(monitors)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(monitors.status, 'armed'), lte(monitors.expiresAt, now)))
    .returning()
    .all()
}
