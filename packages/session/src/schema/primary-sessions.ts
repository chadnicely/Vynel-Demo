// The `primary_sessions` table — one row per workspace: the stable "primary
// session" identity that maps to the CURRENT SDK session id. The primary id
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
// `scope` distinguishes the two kinds of primary (agent-base Slice 3b). A
// `'workspace'` primary belongs to a workspace (the per-workspace brain); the single
// `'global'` primary per user — the global brain that sits ABOVE all workspaces — has
// NONE. `scope` is NOT NULL DEFAULT `'workspace'` so the column is purely additive:
// every pre-existing row backfills to `'workspace'`.
//
// `workspaceId` is therefore a NULLABLE FK → workspaces.id (cascade): non-null for a
// workspace primary, NULL for the global primary. Uses `text().references(...)` rather
// than `id()` because `id()` is NOT NULL by dialect contract; nullable FKs use
// `text().references(...)` (the `agents.workspaceId` precedent). Two partial unique
// indexes pin liveness: one live WORKSPACE primary per (user, workspace), and one live
// GLOBAL primary per user (SQLite treats NULLs as distinct, so the workspace index
// can't pin the NULL-workspace global — a separate scope-gated index is required).
//
// `deletedAt` is the soft-delete column (data-standard "Soft delete");
// default retention window 30 days, hard-deleted by the repo's
// `hardDeletePrimarySessionsDeletedBefore` (the scheduled purge caller is a
// follow-up unit).

import { sql } from 'drizzle-orm'
import { table, id, text, timestamp, integer, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// The kinds of continuing session this table holds. Primaries are the MANAGER
// identities — the per-workspace brain (`'workspace'`) and the single global
// brain (`'global'`, Slice 3b). `'voice'` is the first NON-primary continuing
// session (voice-continuity piece 1 — the voice session is continuous too). The
// continuity MECHANISM (detect-pressure + seed-fresh swap) is scope-agnostic,
// so any kind added here gets continuity for free. `'spawned'` (session-library
// Slice ④) is a session a ROOT creates as a tool — MANY per user (and, since
// Slice ④b, many per creating workspace: a workspace-spawned row carries its
// workspace's id) by design, so it deliberately has NO liveness unique index
// (every partial index below is scope-gated away from it). `'agent'` (the
// persona-sessions arc) is a COLLEAGUE — one continuing session per
// (user, workspace|global, agent), keyed by `scopeRef` = the agent slug, so
// every `@mention` resumes the same session and persona + memory accumulate.
export type PrimarySessionScope = 'global' | 'workspace' | 'voice' | 'spawned' | 'agent'

export const primarySessions = table(
  'primary_sessions',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: non-null for a workspace primary, NULL for the global primary.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // NOT NULL DEFAULT 'workspace' — additive; pre-existing rows backfill.
    scope: text().$type<PrimarySessionScope>().notNull().default('workspace'),

    // Scope-qualified identity key — the agent SLUG for an `'agent'` colleague
    // (a LOOSE ref: the slug is the mention address and matches
    // `delegation_jobs.agentSlug`; no FK — agents live in another feature).
    // NULL for every other scope (enforced at the op layer,
    // `getOrCreateContinuingSession`).
    scopeRef: text(),

    // The live SDK session id this primary currently points at. Null until a
    // session is first linked (the chat-start / swap wiring sets it). A
    // swap repoints this without changing the primary id.
    currentSdkSessionId: text(),

    // The SDK session id the current one REPLACED at the last swap (the
    // supersession chain marker for the future hard-limit bridge). Null
    // when the primary has never been swapped.
    supersededFromSdkSessionId: text(),

    // The DURABLE pending checkpoint (session-hardening arc, 2026-08-19; was a
    // process-wide Map that died with the API process — "Vynel stopped
    // mid-task and said nothing"). Written by the `checkpoint` tool inside a
    // turn, read + cleared by the continuation loop / the checkpoint
    // follow-up job. All nullable: NULL = no checkpoint pending. `depth` is
    // the consecutive-continuation counter (capped, reset by a genuine turn);
    // `jobId` is the enqueued follow-up job whose claim counts toward the cap
    // (a LOOSE ref into delegation_jobs — no FK across features).
    pendingCheckpointNextStep: text(),
    pendingCheckpointDepth: integer(),
    pendingCheckpointAt: timestamp(),
    pendingCheckpointJobId: text(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => ({
    byUser: index('idx_primary_sessions_user').on(t.userId),
    byWorkspace: index('idx_primary_sessions_workspace').on(t.workspaceId),
    byDeletedAt: index('idx_primary_sessions_deleted_at').on(t.deletedAt),

    // One LIVE WORKSPACE-scope primary (the workspace's brain) per workspace.
    // Partial on `deleted_at IS NULL` so a soft-deleted primary's workspace can
    // get a fresh primary (the `installed_skills` / `agents` partial-unique
    // precedent). Scope-gated (Slice ④b, migration 0013): workspace-SPAWNED
    // primaries also carry a workspaceId and are MANY per workspace — without
    // the gate this index capped them at one and collided them with the brain.
    // Works identically in Postgres Phase 2.
    uniqueLivePrimaryPerWorkspace: uniqueIndex('uniq_primary_sessions_user_workspace')
      .on(t.userId, t.workspaceId)
      .where(sql`${t.scope} = 'workspace' AND ${t.deletedAt} IS NULL`),

    // One LIVE global primary per user (Slice 3b). The global primary's workspaceId is
    // NULL, and SQLite treats NULLs as distinct in a unique index, so the
    // workspace index above can't pin it — this scope-gated partial index does.
    // Same shape works in Postgres Phase 2.
    uniqueLiveGlobalPrimaryPerUser: uniqueIndex('uniq_primary_sessions_global_user')
      .on(t.userId)
      .where(sql`${t.scope} = 'global' AND ${t.deletedAt} IS NULL`),

    // One LIVE voice continuing-session per user (voice-continuity piece 1). Voice is
    // global-scoped (workspaceId NULL); like the global primary, SQLite treats NULLs
    // as distinct so the workspace index can't pin it — this scope-gated partial
    // index does. Same shape works in Postgres Phase 2.
    uniqueLiveVoicePrimaryPerUser: uniqueIndex('uniq_primary_sessions_voice_user')
      .on(t.userId)
      .where(sql`${t.scope} = 'voice' AND ${t.deletedAt} IS NULL`),

    // One LIVE agent COLLEAGUE per (user, workspace, agent slug) — the
    // persona-sessions arc. NULL-workspace (global) colleagues escape this index
    // (SQLite NULL-distinct, same story as the global primary), so the global
    // sibling below pins them. Same shape works in Postgres Phase 2.
    uniqueLiveAgentPerWorkspace: uniqueIndex('uniq_primary_sessions_agent_workspace')
      .on(t.userId, t.workspaceId, t.scopeRef)
      .where(sql`${t.scope} = 'agent' AND ${t.deletedAt} IS NULL`),

    // One LIVE GLOBAL agent colleague per (user, agent slug) — the NULL-workspace
    // half of the pair above.
    uniqueLiveAgentGlobalPerUser: uniqueIndex('uniq_primary_sessions_agent_global')
      .on(t.userId, t.scopeRef)
      .where(sql`${t.scope} = 'agent' AND ${t.workspaceId} IS NULL AND ${t.deletedAt} IS NULL`),
  }),
)

export type PrimarySessionRow = typeof primarySessions.$inferSelect
export type NewPrimarySessionRow = typeof primarySessions.$inferInsert
