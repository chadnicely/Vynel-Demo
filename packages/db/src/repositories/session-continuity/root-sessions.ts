// Functional repository for the `root_sessions` table. `db` is the first
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
import type { Database } from '../../client.js'
import {
  rootSessions,
  type RootSessionRow,
  type NewRootSessionRow,
} from '../../schema/session-continuity/root-sessions.js'

export type {
  RootSessionRow,
  NewRootSessionRow,
  RootSessionScope,
} from '../../schema/session-continuity/root-sessions.js'

export function findRootSessionById(db: Database, rootSessionId: string): RootSessionRow | null {
  const [row] = db
    .select()
    .from(rootSessions)
    .where(and(eq(rootSessions.id, rootSessionId), isNull(rootSessions.deletedAt)))
    .limit(1)
    .all()
  return row ?? null
}

// Resolves the live root that currently points at a given SDK session id —
// the correlation the PostCompact capture uses (the hook only knows the SDK
// session id; the root carries the tenant). Null when no live root maps to
// it (the session isn't a tracked root).
export function findRootSessionByCurrentSdkSessionId(
  db: Database,
  sdkSessionId: string,
): RootSessionRow | null {
  const [row] = db
    .select()
    .from(rootSessions)
    .where(
      and(eq(rootSessions.currentSdkSessionId, sdkSessionId), isNull(rootSessions.deletedAt)),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type FindRootSessionForWorkspaceInput = {
  userId: string
  workspaceId: string
}

// The single live root for a (user, workspace) — null if none exists yet.
// The partial unique index guarantees at most one live row.
export function findRootSessionForWorkspace(
  db: Database,
  input: FindRootSessionForWorkspaceInput,
): RootSessionRow | null {
  const [row] = db
    .select()
    .from(rootSessions)
    .where(
      and(
        eq(rootSessions.userId, input.userId),
        eq(rootSessions.workspaceId, input.workspaceId),
        isNull(rootSessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// The single live GLOBAL root for a user (Slice 3b) — null if none exists yet.
// `workspaceId` is NULL for the global root, so resolution is by (userId, scope).
// The partial unique index guarantees at most one live global row per user.
export function findGlobalRootSessionForUser(db: Database, userId: string): RootSessionRow | null {
  const [row] = db
    .select()
    .from(rootSessions)
    .where(
      and(
        eq(rootSessions.userId, userId),
        eq(rootSessions.scope, 'global'),
        isNull(rootSessions.deletedAt),
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
export function findVoiceRootSessionForUser(db: Database, userId: string): RootSessionRow | null {
  const [row] = db
    .select()
    .from(rootSessions)
    .where(
      and(
        eq(rootSessions.userId, userId),
        eq(rootSessions.scope, 'voice'),
        isNull(rootSessions.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// All live roots for a user — the `monitor` tree's top level (every workspace
// root today; + the global root once Slice 3b lands). Tenant-filtered; excludes
// soft-deleted. Intrinsically bounded (one root per workspace) so no cursor.
export function listRootSessionsForUser(db: Database, userId: string): RootSessionRow[] {
  return db
    .select()
    .from(rootSessions)
    .where(and(eq(rootSessions.userId, userId), isNull(rootSessions.deletedAt)))
    .all()
}

export function insertRootSession(db: Database, newRow: NewRootSessionRow): RootSessionRow {
  const [inserted] = db.insert(rootSessions).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertRootSession: no row returned')
  }
  return inserted
}

export type RepointRootSessionInput = {
  rootSessionId: string
  userId: string
  // The SDK session the root now points at.
  currentSdkSessionId: string
  // The SDK session being replaced (recorded as the supersession marker).
  supersededFromSdkSessionId?: string | null
}

// Repoints a root at a (new) SDK session — the chat-start link + the
// future swap both use this. Tenant-filtered; null when no live row
// matched. Identity columns (`id`, `userId`, `workspaceId`, `createdAt`)
// are never changed here.
export function repointRootSession(
  db: Database,
  input: RepointRootSessionInput,
): RootSessionRow | null {
  const [updated] = db
    .update(rootSessions)
    .set({
      currentSdkSessionId: input.currentSdkSessionId,
      ...(input.supersededFromSdkSessionId !== undefined
        ? { supersededFromSdkSessionId: input.supersededFromSdkSessionId }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(rootSessions.id, input.rootSessionId),
        eq(rootSessions.userId, input.userId),
        isNull(rootSessions.deletedAt),
      ),
    )
    .returning()
    .all()
  return updated ?? null
}

// Soft-delete: sets `deletedAt`. Tenant-filtered; only affects a live row.
export function softDeleteRootSession(
  db: Database,
  rootSessionId: string,
  userId: string,
): RootSessionRow | null {
  const now = new Date()
  const [updated] = db
    .update(rootSessions)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(rootSessions.id, rootSessionId),
        eq(rootSessions.userId, userId),
        isNull(rootSessions.deletedAt),
      ),
    )
    .returning()
    .all()
  return updated ?? null
}

// Retention purge primitive — hard-deletes roots soft-deleted before the
// cutoff. Returns the count removed. The scheduled caller (purge worker
// job) is a follow-up unit; this is the data-layer mechanism it will use.
export function hardDeleteRootSessionsDeletedBefore(db: Database, cutoff: Date): number {
  const deleted = db.delete(rootSessions).where(lt(rootSessions.deletedAt, cutoff)).returning().all()
  return deleted.length
}
