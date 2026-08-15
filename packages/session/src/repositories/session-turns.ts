// Functional repository for the `session_turns` table — the durable turn
// envelope (persona-sessions). `db` first arg; Phase 1 SYNC returns. Written
// through ONE seam (the `SessionActivityFeed` recorder), read by the
// running-turns rebuild + the boot reap. Every read encodes the `userId`
// filter where a tenant is in play.

import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  sessionTurns,
  type SessionTurnRow,
  type NewSessionTurnRow,
} from '../schema/session-turns.js'

export type {
  SessionTurnRow,
  NewSessionTurnRow,
  SessionTurnEndedReason,
} from '../schema/session-turns.js'

export function insertSessionTurn(db: Database, row: NewSessionTurnRow): SessionTurnRow {
  const [inserted] = db.insert(sessionTurns).values(row).returning().all()
  if (!inserted) throw new Error('insertSessionTurn: no row returned')
  return inserted
}

/** The runtime learned the SDK session this turn runs on (or re-learned it on
 *  a mid-turn swap). Only a still-running row moves. */
export function resolveSessionTurnSession(
  db: Database,
  turnId: string,
  sessionId: string,
): void {
  db.update(sessionTurns)
    .set({ sessionId })
    .where(and(eq(sessionTurns.id, turnId), isNull(sessionTurns.endedAt)))
    .run()
}

export function endSessionTurn(
  db: Database,
  turnId: string,
  endedAt: Date,
  reason: 'ended' | 'failed' = 'ended',
): void {
  db.update(sessionTurns)
    .set({ endedAt, endedReason: reason })
    .where(and(eq(sessionTurns.id, turnId), isNull(sessionTurns.endedAt)))
    .run()
}

/** Boot recovery (the tool-call reap precedent): the previous process died with
 *  these turns running — close them as 'orphaned' so the rebuild read never
 *  reports a ghost. Returns the count reaped. */
export function reapOrphanedSessionTurns(db: Database, at: Date): number {
  const reaped = db
    .update(sessionTurns)
    .set({ endedAt: at, endedReason: 'orphaned' })
    .where(isNull(sessionTurns.endedAt))
    .returning({ id: sessionTurns.id })
    .all()
  return reaped.length
}

/** The user's RUNNING turns — the refresh/restart rebuild seed for the live
 *  views (endedAt IS NULL, oldest first for stable presentation). */
export function listRunningSessionTurnsForUser(db: Database, userId: string): SessionTurnRow[] {
  return db
    .select()
    .from(sessionTurns)
    .where(and(eq(sessionTurns.userId, userId), isNull(sessionTurns.endedAt)))
    .orderBy(sessionTurns.startedAt, sessionTurns.id)
    .all()
}

/** The LATEST workspace-scoped turn per workspace (any liveness) — the
 *  workspace status read's "did the last run fail / is one running" input.
 *  A per-user scan over the purge-bounded envelope table; newest wins per
 *  workspace in one ordered pass. */
export function listLatestWorkspaceTurnsForUser(
  db: Database,
  userId: string,
): Map<string, SessionTurnRow> {
  const rows = db
    .select()
    .from(sessionTurns)
    .where(and(eq(sessionTurns.userId, userId), eq(sessionTurns.scopeKind, 'workspace')))
    .orderBy(sessionTurns.startedAt, sessionTurns.id)
    .all()
  const latestByWorkspaceId = new Map<string, SessionTurnRow>()
  for (const row of rows) {
    if (row.workspaceId !== null) latestByWorkspaceId.set(row.workspaceId, row)
  }
  return latestByWorkspaceId
}

/** Retention purge primitive — hard-deletes ENDED turns older than the cutoff
 *  (liveness bookkeeping, not user-visible history). Returns the count. */
export function purgeEndedSessionTurnsBefore(db: Database, cutoff: Date): number {
  const purged = db
    .delete(sessionTurns)
    .where(lt(sessionTurns.endedAt, cutoff))
    .returning({ id: sessionTurns.id })
    .all()
  return purged.length
}
