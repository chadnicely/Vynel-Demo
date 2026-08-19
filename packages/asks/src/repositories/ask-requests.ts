// Functional repository for the `ask_requests` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this
// repo.

import { and, desc, eq, lt } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { askRequests, type AskRequest, type NewAskRequest } from '../schema/ask-requests.js'

export type { AskRequest, NewAskRequest, AskRequestStatus } from '../schema/ask-requests.js'

// A user answers asks as they arrive — the pending set is tiny; cap defensively.
const PENDING_LIST_LIMIT = 20

export function insertAskRequest(db: Database, row: NewAskRequest): AskRequest {
  const [inserted] = db.insert(askRequests).values(row).returning().all()
  if (!inserted) throw new Error('insertAskRequest: no row returned')
  return inserted
}

export function findAskRequestById(db: Database, id: string): AskRequest | null {
  const [row] = db.select().from(askRequests).where(eq(askRequests.id, id)).limit(1).all()
  return row ?? null
}

export function listPendingAskRequestsForUser(db: Database, userId: string): AskRequest[] {
  return db
    .select()
    .from(askRequests)
    .where(and(eq(askRequests.userId, userId), eq(askRequests.status, 'pending')))
    .orderBy(desc(askRequests.createdAt))
    .limit(PENDING_LIST_LIMIT)
    .all()
}

// Every pending row regardless of tenant — the boot-recovery read (single-user
// Phase 1; the recovery pass is process-wide by design).
export function listAllPendingAskRequests(db: Database): AskRequest[] {
  return db.select().from(askRequests).where(eq(askRequests.status, 'pending')).all()
}

// The pending rows older than the cutoff, process-wide — the running reaper's
// read (an orphaned row is one nobody will ever answer, whoever owns it).
export function listPendingAskRequestsCreatedBefore(db: Database, cutoff: Date): AskRequest[] {
  return db
    .select()
    .from(askRequests)
    .where(and(eq(askRequests.status, 'pending'), lt(askRequests.createdAt, cutoff)))
    .all()
}

export function updateAskRequest(
  db: Database,
  id: string,
  patch: Partial<NewAskRequest>,
): AskRequest {
  const [updated] = db.update(askRequests).set(patch).where(eq(askRequests.id, id)).returning().all()
  if (!updated) throw new Error(`updateAskRequest: no row for ${id}`)
  return updated
}
