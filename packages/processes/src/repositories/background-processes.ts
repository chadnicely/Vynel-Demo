// Functional repository for the `background_processes` table. `db` is the
// first argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside
// this repo.

import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  backgroundProcesses,
  type BackgroundProcess,
  type NewBackgroundProcess,
  type BackgroundProcessStatus,
} from '../schema/background-processes.js'

export type {
  BackgroundProcess,
  NewBackgroundProcess,
  BackgroundProcessStatus,
  BackgroundProcessOwnerKind,
} from '../schema/background-processes.js'

// A session's processes are few by design; cap defensively anyway.
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

export function insertBackgroundProcess(
  db: Database,
  row: NewBackgroundProcess,
): BackgroundProcess {
  const [inserted] = db.insert(backgroundProcesses).values(row).returning().all()
  if (!inserted) throw new Error('insertBackgroundProcess: no row returned')
  return inserted
}

export function findBackgroundProcessById(db: Database, id: string): BackgroundProcess | null {
  const [row] = db
    .select()
    .from(backgroundProcesses)
    .where(eq(backgroundProcesses.id, id))
    .limit(1)
    .all()
  return row ?? null
}

/** A workspace's processes — the workspace door's list. */
export function listBackgroundProcessesForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string; status?: BackgroundProcessStatus; limit?: number },
): BackgroundProcess[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [
    eq(backgroundProcesses.userId, input.userId),
    eq(backgroundProcesses.workspaceId, input.workspaceId),
  ]
  if (input.status) filters.push(eq(backgroundProcesses.status, input.status))
  return db
    .select()
    .from(backgroundProcesses)
    .where(and(...filters))
    .orderBy(desc(backgroundProcesses.createdAt), desc(backgroundProcesses.id))
    .limit(limit)
    .all()
}

/** The GLOBAL scope's processes — workspaceId IS NULL, never "all of the
 *  user's" (the strict-scope-visibility rule). */
export function listGlobalBackgroundProcessesForUser(
  db: Database,
  input: { userId: string; status?: BackgroundProcessStatus; limit?: number },
): BackgroundProcess[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(backgroundProcesses.userId, input.userId), isNull(backgroundProcesses.workspaceId)]
  if (input.status) filters.push(eq(backgroundProcesses.status, input.status))
  return db
    .select()
    .from(backgroundProcesses)
    .where(and(...filters))
    .orderBy(desc(backgroundProcesses.createdAt), desc(backgroundProcesses.id))
    .limit(limit)
    .all()
}

/** How many of the user's processes are LIVE — the concurrency cap's read. */
export function countRunningBackgroundProcessesForUser(db: Database, userId: string): number {
  const [row] = db
    .select({ value: count() })
    .from(backgroundProcesses)
    .where(
      and(eq(backgroundProcesses.userId, userId), eq(backgroundProcesses.status, 'running')),
    )
    .all()
  return row?.value ?? 0
}

/** Every row a crash left `running` — the boot sweep's read (all tenants:
 *  a restart orphans every user's children alike). */
export function listRunningBackgroundProcesses(db: Database): BackgroundProcess[] {
  return db
    .select()
    .from(backgroundProcesses)
    .where(eq(backgroundProcesses.status, 'running'))
    .all()
}

/** Flip a RUNNING row terminal — guarded on status so a settle can never run
 *  twice (the runner settles once by construction, but the sweep and a settle
 *  can race across a restart; first write wins). Returns the updated row, or
 *  null when the row was already terminal. */
export function settleBackgroundProcessRow(
  db: Database,
  input: {
    id: string
    status: 'succeeded' | 'failed'
    exitCode: number | null
    failureReason: BackgroundProcess['failureReason']
    outputTail: string
    finishedAt: Date
  },
): BackgroundProcess | null {
  const [updated] = db
    .update(backgroundProcesses)
    .set({
      status: input.status,
      exitCode: input.exitCode,
      failureReason: input.failureReason,
      outputTail: input.outputTail,
      finishedAt: input.finishedAt,
      updatedAt: input.finishedAt,
    })
    .where(
      and(eq(backgroundProcesses.id, input.id), eq(backgroundProcesses.status, 'running')),
    )
    .returning()
    .all()
  return updated ?? null
}

/** Stamp the pid once the spawn assigned one. */
export function recordBackgroundProcessPid(
  db: Database,
  input: { id: string; pid: number; updatedAt: Date },
): void {
  db.update(backgroundProcesses)
    .set({ pid: input.pid, updatedAt: input.updatedAt })
    .where(eq(backgroundProcesses.id, input.id))
    .run()
}
