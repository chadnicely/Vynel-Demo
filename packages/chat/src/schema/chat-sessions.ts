// The `chat_sessions` table for the `chat` domain — one row per conversation,
// scoped per workspace, soft-deletable. See
// `docs/blueprints/chat/blueprint.md §3.1`.
//
// Phase 1 SYNC discipline applies — see
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// id is `text()` (not `id()`) because the SDK assigns the session id at the
// first event of a turn (D2). The mixed PK source (assistant: provider id;
// user/tool-call: Vynel UUID) is D15.
//
// `deletedAt` is the soft-delete column (D14 — 30-day retention + purge job
// in apps/worker/src/jobs/chat/purge-deleted-chat-sessions.ts). `isArchived`
// is a separate "hide from default list" affordance — independent of
// `deletedAt`.
//
// Denormalized counters (totalMessageCount, totalInputTokens,
// totalOutputTokens) are SQL-side incremented via the
// `incrementChatSessionCounters` repo function (D8 + coding §1.3).

import { desc } from 'drizzle-orm'
import { table, id, text, timestamp, boolean, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// Sidebar curation (agent-base Slice 2). `'listed'` = a normal conversation
// shown in the curated sidebar; `'hidden'` = recorded + browsable but kept out
// of the list (the root-as-thread swap segments + the root's own segments, so
// the continuing brain shows as ONE entry, not a growing chain). "Hide for the
// UI; keep for the platform" — `.claude/docs/agent-base/root-session-architecture.md §7`.
export type ChatSessionVisibility = 'listed' | 'hidden'

// The session's scope — the explicit type discriminator (mirrors
// `primary_sessions.scope`). `'workspace'` = the user's direct conversation in a
// workspace; `'global'` = the global root (the brain above all workspaces,
// `workspaceId` null); `'agent'` = a delegated agent/leaf session. Lets the
// platform — and a future "read session history" tool — filter sessions by type
// instead of inferring from `workspaceId IS NULL`. NOT NULL DEFAULT `'workspace'`
// so the column is purely additive (every pre-existing row backfills to
// `'workspace'`). `'spawned'` (session-library Slice ④) = a session the root
// created as a tool — global-grounded (`workspaceId` null) but LISTED under its
// own name, unlike the hidden global-brain segments.
export type ChatSessionScope = 'global' | 'workspace' | 'agent' | 'spawned'

export const chatSessions = table(
  'chat_sessions',
  {
    id: text().primaryKey(), // SDK-assigned per D2; not Vynel UUID
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable (agent-base Slice 3b): a workspace conversation carries its
    // workspace id; the GLOBAL root's recorded segments have NO workspace (the
    // global brain sits above all workspaces). Additive — every pre-existing row
    // keeps its non-null workspace id; D15 is untouched (the PK is still the SDK id).
    // Uses `text().references(...)` since `id()` is NOT NULL by dialect contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'claude' | 'codex' | 'gemini' | 'cursor' — validated at the application
    // layer (Zod) per the provider-preferences precedent; db doesn't depend
    // on @vynel/providers (would invert the dep direction).
    providerId: text().notNull(),
    // The AI model the session actually ran with (e.g. 'claude-opus-4-8'),
    // captured from the assistant message's `model` field. Nullable: null for
    // sessions created before this column + until the first assistant response.
    // Drives the context-window denominator (200k vs 1M) for the usage chip.
    model: text(),
    title: text().notNull(),
    // Sidebar curation (Slice 2). NOT NULL DEFAULT 'listed' so the column is
    // purely additive — every pre-existing session backfills to 'listed' and
    // keeps showing in the sidebar (no D15/PK change).
    visibility: text().$type<ChatSessionVisibility>().notNull().default('listed'),
    // The explicit session-type discriminator — see `ChatSessionScope` above.
    scope: text().$type<ChatSessionScope>().notNull().default('workspace'),
    isArchived: boolean().notNull(),
    // The session's CURRENT context occupancy — the full input side of the
    // latest assistant request (input + cache read + cache creation), written
    // by handle-usage-reported beside its per-message write. Null until the
    // first usage report. Numerator of the UI context meter and the root's
    // planning number (`contextWindowForModel(model)` is the denominator).
    lastContextTokens: integer(),
    // The continuity chain link: the session id this swap segment CONTINUED
    // from, stamped by recordSwapSegmentSession at swap time. Null = chain
    // head. LOOSE ref (no FK) — segments purge independently.
    continuedFromSessionId: text(),
    deletedAt: timestamp(), // soft-delete (D14); null = active
    totalMessageCount: integer().notNull(),
    totalInputTokens: integer().notNull(),
    totalOutputTokens: integer().notNull(),
    startedAt: timestamp().notNull(),
    lastMessageAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdx: index('idx_chat_sessions_user').on(t.userId),
    workspaceArchivedIdx: index('idx_chat_sessions_workspace_archived').on(
      t.workspaceId,
      t.isArchived,
    ),
    workspaceDeletedAtIdx: index('idx_chat_sessions_workspace_deleted_at').on(
      t.workspaceId,
      t.deletedAt,
    ),
    lastMessageAtIdx: index('idx_chat_sessions_last_message_at').on(desc(t.lastMessageAt)),
  }),
)

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert
