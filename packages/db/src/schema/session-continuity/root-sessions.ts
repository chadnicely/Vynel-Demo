// The `root_sessions` table — one row per workspace: the stable "root
// session" identity that maps to the CURRENT SDK session id. The root id
// never changes; the SDK session under it can be swapped (the transparent
// context-limit bridge — a follow-up unit), so the user's thread identity
// is unbroken forever. Spec: `docs/agent-base/session-continuity.md`
// "The model" + "Schema".
//
// DEDICATED table (NOT an extension of `chat`'s session table) — keeps
// `chat` focused on the message transcript; this domain owns the live SDK
// session lifecycle + continuity (session-continuity decisions, locked).
//
// `userId` is the tenant boundary (FK → users.id, cascade) — present on
// every row even though Phase 1 has one user, so Phase 2 multi-user is a
// data-only migration (data-standard "Ownership / identity").
//
// `scope` distinguishes the two kinds of root (agent-base Slice 3b). A
// `'workspace'` root belongs to a workspace (the per-workspace brain); the single
// `'global'` root per user — the global brain that sits ABOVE all workspaces — has
// NONE. `scope` is NOT NULL DEFAULT `'workspace'` so the column is purely additive:
// every pre-existing row backfills to `'workspace'`.
//
// `workspaceId` is therefore a NULLABLE FK → workspaces.id (cascade): non-null for a
// workspace root, NULL for the global root. Uses `text().references(...)` rather
// than `id()` because `id()` is NOT NULL by dialect contract; nullable FKs use
// `text().references(...)` (the `agents.workspaceId` precedent). Two partial unique
// indexes pin liveness: one live WORKSPACE root per (user, workspace), and one live
// GLOBAL root per user (SQLite treats NULLs as distinct, so the workspace index
// can't pin the NULL-workspace global — a separate scope-gated index is required).
//
// `deletedAt` is the soft-delete column (data-standard "Soft delete");
// default retention window 30 days, hard-deleted by the repo's
// `hardDeleteRootSessionsDeletedBefore` (the scheduled purge caller is a
// follow-up unit).

import { sql } from 'drizzle-orm'
import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from '../workspaces/workspaces.js'

// The kinds of continuing session this table holds. Roots are the MANAGER
// identities — the per-workspace brain (`'workspace'`) and the single global
// brain (`'global'`, Slice 3b). `'voice'` is the first NON-root continuing
// session (voice-jarvis piece 1 — the Jarvis session is continuous too). The
// continuity MECHANISM (detect-pressure + seed-fresh swap) is scope-agnostic,
// so any kind added here gets continuity for free. Agents (many-per-user, keyed
// by a scopeRef) are a later kind — deferred, don't over-fit now.
export type RootSessionScope = 'global' | 'workspace' | 'voice'

export const rootSessions = table(
  'root_sessions',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: non-null for a workspace root, NULL for the global root.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // NOT NULL DEFAULT 'workspace' — additive; pre-existing rows backfill.
    scope: text().$type<RootSessionScope>().notNull().default('workspace'),

    // The live SDK session id this root currently points at. Null until a
    // session is first linked (the chat-start / swap wiring sets it). A
    // swap repoints this without changing the root id.
    currentSdkSessionId: text(),

    // The SDK session id the current one REPLACED at the last swap (the
    // supersession chain marker for the future hard-limit bridge). Null
    // when the root has never been swapped.
    supersededFromSdkSessionId: text(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => ({
    byUser: index('idx_root_sessions_user').on(t.userId),
    byWorkspace: index('idx_root_sessions_workspace').on(t.workspaceId),
    byDeletedAt: index('idx_root_sessions_deleted_at').on(t.deletedAt),

    // One LIVE root per workspace. Partial on `deleted_at IS NULL` so a
    // soft-deleted root's workspace can get a fresh root (the
    // `installed_skills` / `agents` partial-unique precedent). Works
    // identically in Postgres Phase 2.
    uniqueLiveRootPerWorkspace: uniqueIndex('uniq_root_sessions_user_workspace')
      .on(t.userId, t.workspaceId)
      .where(sql`${t.deletedAt} IS NULL`),

    // One LIVE global root per user (Slice 3b). The global root's workspaceId is
    // NULL, and SQLite treats NULLs as distinct in a unique index, so the
    // workspace index above can't pin it — this scope-gated partial index does.
    // Same shape works in Postgres Phase 2.
    uniqueLiveGlobalRootPerUser: uniqueIndex('uniq_root_sessions_global_user')
      .on(t.userId)
      .where(sql`${t.scope} = 'global' AND ${t.deletedAt} IS NULL`),

    // One LIVE voice continuing-session per user (voice-jarvis piece 1). Voice is
    // global-scoped (workspaceId NULL); like the global root, SQLite treats NULLs
    // as distinct so the workspace index can't pin it — this scope-gated partial
    // index does. Same shape works in Postgres Phase 2.
    uniqueLiveVoiceRootPerUser: uniqueIndex('uniq_root_sessions_voice_user')
      .on(t.userId)
      .where(sql`${t.scope} = 'voice' AND ${t.deletedAt} IS NULL`),
  }),
)

export type RootSessionRow = typeof rootSessions.$inferSelect
export type NewRootSessionRow = typeof rootSessions.$inferInsert
