// The durable pending-checkpoint SLOT of `primary_sessions` (session-hardening
// arc, 2026-08-19) — four nullable columns on the identity's own row (see the
// schema comment): `pendingCheckpointNextStep` + `pendingCheckpointAt` = the
// checkpoint itself, `pendingCheckpointDepth` = the consecutive-continuation
// counter, `pendingCheckpointJobId` = the follow-up job the checkpoint was
// handed to. A sibling of `primary-sessions.ts` (which sits at the file-size
// cap). The STATE MACHINE (mark / peek / take / hand over / claim / genuine
// reset) lives in `continuity/pending-checkpoints.ts`; this layer only offers
// the typed patch + the one finder it needs — live rows only, `db` first, sync.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { primarySessions, type PrimarySessionRow } from '../schema/primary-sessions.js'

export type PendingCheckpointPatch = Partial<
  Pick<
    PrimarySessionRow,
    | 'pendingCheckpointNextStep'
    | 'pendingCheckpointDepth'
    | 'pendingCheckpointAt'
    | 'pendingCheckpointJobId'
  >
>

// Writes only the given slot columns (an omitted column stays as it is) on a
// LIVE row. Returns the updated row, or null when no live row matched.
export function patchPendingCheckpoint(
  db: Database,
  primarySessionId: string,
  patch: PendingCheckpointPatch,
): PrimarySessionRow | null {
  const [updated] = db
    .update(primarySessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(primarySessions.id, primarySessionId), isNull(primarySessions.deletedAt)))
    .returning()
    .all()
  return updated ?? null
}

// The live primary whose pending checkpoint was handed to `jobId` (a follow-up
// job claiming its turn asks "is this me?"). Null = no identity remembers that
// job — it is a genuine turn. A scan of a small table (one row per continuing
// identity); an index is a later migration if the table ever grows.
export function findPrimarySessionByPendingCheckpointJobId(
  db: Database,
  jobId: string,
): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(eq(primarySessions.pendingCheckpointJobId, jobId), isNull(primarySessions.deletedAt)),
    )
    .limit(1)
    .all()
  return row ?? null
}
