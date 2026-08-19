// Functional repository for the `primary_sessions` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3`). Phase 1 SYNC return values
// (`.claude/memory/decisions/phase-1-sync-transactions.md`).
//
// `find*` returns null on missing; typed throws happen at the core
// boundary (`.claude/rules/error-handling.md` "Layering" — repos throw
// only plain `Error` for internal-invariant violations).
//
// Normal reads filter `deletedAt IS NULL`. Every read/mutation encodes the
// `userId` filter (data-standard "Tenant isolation by repo-layer
// convention") — a cross-tenant row matches nothing → null.

import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  primarySessions,
  type PrimarySessionRow,
  type NewPrimarySessionRow,
} from '../schema/primary-sessions.js'

export type {
  PrimarySessionRow,
  NewPrimarySessionRow,
  PrimarySessionScope,
} from '../schema/primary-sessions.js'

export function findPrimarySessionById(db: Database, primarySessionId: string): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(and(eq(primarySessions.id, primarySessionId), isNull(primarySessions.deletedAt)))
    .limit(1)
    .all()
  return row ?? null
}

// Resolves the live primary that currently points at a given SDK session id —
// the correlation the PostCompact capture uses (the hook only knows the SDK
// session id; the primary carries the tenant). Null when no live primary maps to
// it (the session isn't a tracked primary).
export function findPrimarySessionByCurrentSdkSessionId(
  db: Database,
  sdkSessionId: string,
): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(eq(primarySessions.currentSdkSessionId, sdkSessionId), isNull(primarySessions.deletedAt)),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type FindPrimarySessionForWorkspaceInput = {
  userId: string
  workspaceId: string
}

// The single live WORKSPACE-scope primary (the workspace's brain) for a
// (user, workspace) — null if none exists yet. The scope-gated partial unique
// index guarantees at most one live row; the query filters scope to match
// (Slice ④b: workspace-SPAWNED primaries also carry a workspaceId and are many
// per workspace — without the scope filter one of them could masquerade as the
// brain here and in getOrCreateContinuingSession's find-live).
export function findPrimarySessionForWorkspace(
  db: Database,
  input: FindPrimarySessionForWorkspaceInput,
): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(
        eq(primarySessions.userId, input.userId),
        eq(primarySessions.workspaceId, input.workspaceId),
        eq(primarySessions.scope, 'workspace'),
        isNull(primarySessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// The single live GLOBAL primary for a user (Slice 3b) — null if none exists yet.
// `workspaceId` is NULL for the global primary, so resolution is by (userId, scope).
// The partial unique index guarantees at most one live global row per user.
export function findGlobalPrimarySessionForUser(db: Database, userId: string): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(
        eq(primarySessions.userId, userId),
        eq(primarySessions.scope, 'global'),
        isNull(primarySessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// The single live VOICE continuing-session for a user (voice-jarvis piece 1) —
// null if none exists yet. Voice is global-scoped (workspaceId NULL); resolution
// is by (userId, scope='voice'). The partial unique index guarantees at most one
// live voice row per user.
export function findVoicePrimarySessionForUser(db: Database, userId: string): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(
        eq(primarySessions.userId, userId),
        eq(primarySessions.scope, 'voice'),
        isNull(primarySessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type FindAgentPrimarySessionInput = {
  userId: string
  /** The colleague's grounding — null resolves the GLOBAL colleague. */
  workspaceId: string | null
  /** The agent slug (the mention address). */
  scopeRef: string
}

// The single live agent COLLEAGUE for a (user, workspace|global, agent slug) —
// null if none exists yet (persona-sessions arc). The scope-gated partial
// unique index pair guarantees at most one live row per grounding; the query
// branches on the grounding the same way the indexes do (NULL-distinct).
export function findAgentPrimarySession(
  db: Database,
  input: FindAgentPrimarySessionInput,
): PrimarySessionRow | null {
  const [row] = db
    .select()
    .from(primarySessions)
    .where(
      and(
        eq(primarySessions.userId, input.userId),
        input.workspaceId === null
          ? isNull(primarySessions.workspaceId)
          : eq(primarySessions.workspaceId, input.workspaceId),
        eq(primarySessions.scope, 'agent'),
        eq(primarySessions.scopeRef, input.scopeRef),
        isNull(primarySessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// All live primaries for a user — the `monitor` tree's top level (every workspace
// primary today; + the global primary once Slice 3b lands). Tenant-filtered; excludes
// soft-deleted. Intrinsically bounded (one primary per workspace) so no cursor.
export function listPrimarySessionsForUser(db: Database, userId: string): PrimarySessionRow[] {
  return db
    .select()
    .from(primarySessions)
    .where(and(eq(primarySessions.userId, userId), isNull(primarySessions.deletedAt)))
    .all()
}

export function insertPrimarySession(db: Database, newRow: NewPrimarySessionRow): PrimarySessionRow {
  const [inserted] = db.insert(primarySessions).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertPrimarySession: no row returned')
  }
  return inserted
}

export type RepointPrimarySessionInput = {
  primarySessionId: string
  userId: string
  // The SDK session the primary now points at.
  currentSdkSessionId: string
  // The SDK session being replaced (recorded as the supersession marker).
  supersededFromSdkSessionId?: string | null
}

// Repoints a primary at a (new) SDK session — the chat-start link + the
// future swap both use this. Tenant-filtered; null when no live row
// matched. Identity columns (`id`, `userId`, `workspaceId`, `createdAt`)
// are never changed here.
export function repointPrimarySession(
  db: Database,
  input: RepointPrimarySessionInput,
): PrimarySessionRow | null {
  const [updated] = db
    .update(primarySessions)
    .set({
      currentSdkSessionId: input.currentSdkSessionId,
      ...(input.supersededFromSdkSessionId !== undefined
        ? { supersededFromSdkSessionId: input.supersededFromSdkSessionId }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(primarySessions.id, input.primarySessionId),
        eq(primarySessions.userId, input.userId),
        isNull(primarySessions.deletedAt),
      ),
    )
    .returning()
    .all()
  return updated ?? null
}

// Soft-delete: sets `deletedAt`. Tenant-filtered; only affects a live row.
export function softDeletePrimarySession(
  db: Database,
  primarySessionId: string,
  userId: string,
): PrimarySessionRow | null {
  const now = new Date()
  const [updated] = db
    .update(primarySessions)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(primarySessions.id, primarySessionId),
        eq(primarySessions.userId, userId),
        isNull(primarySessions.deletedAt),
      ),
    )
    .returning()
    .all()
  return updated ?? null
}

// Retention purge primitive — hard-deletes primaries soft-deleted before the
// cutoff. Returns the count removed. The scheduled caller (purge worker
// job) is a follow-up unit; this is the data-layer mechanism it will use.
export function hardDeletePrimarySessionsDeletedBefore(db: Database, cutoff: Date): number {
  const deleted = db.delete(primarySessions).where(lt(primarySessions.deletedAt, cutoff)).returning().all()
  return deleted.length
}

// ── The durable pending-checkpoint slot (session-hardening arc, 2026-08-19) ──
// Four nullable columns on the identity's own row (see the schema comment):
// `pendingCheckpointNextStep` + `pendingCheckpointAt` = the checkpoint itself,
// `pendingCheckpointDepth` = the consecutive-continuation counter,
// `pendingCheckpointJobId` = the follow-up job the checkpoint was handed to.
// The STATE MACHINE (mark / peek / take / hand over / claim / genuine reset)
// lives in `continuity/pending-checkpoints.ts`; this layer only offers the
// typed patch + the one finder it needs, live rows only.

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
// job — it is a genuine turn.
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
