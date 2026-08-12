// Functional repository for `desktop_actions` — the append-only record of what
// Claude did on the user's computer. `db` is the first argument; Phase 1 SYNC
// returns. No raw SQL or Drizzle queries outside this repo.
//
// APPEND and READ only, on purpose. There is no update and no delete: a record
// of what happened that can be edited afterwards is not a record. Retention is a
// pruning job's problem, not this file's.

import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { desktopActions, type DesktopActionOutcome } from '../schema/desktop-actions.js'

export type DesktopActionRow = typeof desktopActions.$inferSelect

export type RecordDesktopActionInput = {
  userId: string
  sessionId?: string | null
  workspaceId?: string | null
  goal?: string | null
  tool: string
  appName?: string | null
  detail: string
  outcome: DesktopActionOutcome
  note?: string | null
}

/** Append one act. Returns the stored row so a caller can surface it without a
 *  second read. */
export function recordDesktopAction(
  db: Database,
  input: RecordDesktopActionInput,
): DesktopActionRow {
  const [row] = db
    .insert(desktopActions)
    .values({
      // The dialect's `id()` carries no DEFAULT — the caller supplies it, the
      // house rule for every table.
      id: randomUUID(),
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId ?? null,
      goal: input.goal ?? null,
      tool: input.tool,
      appName: input.appName ?? null,
      detail: input.detail,
      outcome: input.outcome,
      note: input.note ?? null,
      createdAt: new Date(),
    })
    .returning()
    .all()
  if (row === undefined) {
    throw new Error('recordDesktopAction: insert returned no row.')
  }
  return row
}

/** What Claude did on this machine, newest first — the user-facing log read. */
export function listDesktopActions(
  db: Database,
  userId: string,
  limit = 100,
): DesktopActionRow[] {
  return db
    .select()
    .from(desktopActions)
    .where(eq(desktopActions.userId, userId))
    .orderBy(desc(desktopActions.createdAt))
    .limit(limit)
    .all()
}

/** How far ONE task got — the read behind "last time I got as far as X, shall I
 *  carry on?". Oldest first, because that is the order it happened in and the
 *  order a person reads it. */
export function listDesktopActionsForSession(
  db: Database,
  userId: string,
  sessionId: string,
): DesktopActionRow[] {
  return db
    .select()
    .from(desktopActions)
    .where(and(eq(desktopActions.userId, userId), eq(desktopActions.sessionId, sessionId)))
    .orderBy(desktopActions.createdAt)
    .all()
}
