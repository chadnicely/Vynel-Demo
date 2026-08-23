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
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { SessionSetStatus } from '@vynel/contracts/chat/session-status'

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
// 'voice' (voice-session arc, 2026-08-19) = the spoken twin thread's segments —
// global-grounded and hidden like the brain's, but its own chain, so no scope
// view lists it until a Voice-chat menu ships a filter.
export type ChatSessionScope = 'global' | 'workspace' | 'agent' | 'spawned' | 'voice'

// The user's chosen session mode — mirrors `@vynel/session`'s `SessionMode`
// (chat can't import a sibling leaf; the `ChatSessionScope` mirror precedent).
// Drift is caught downstream where the value feeds `toPermissionMode`.
export type ChatSessionSelectedMode = 'ask' | 'auto' | 'bypass'

// The assistant-set session status — `@vynel/contracts/chat/session-status`'s
// `SessionSetStatus`, imported type-only (contracts is shared-tier).
export type ChatSessionSetStatus = SessionSetStatus

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
    // The session's face beside its name — a curated vocabulary name from
    // `@vynel/contracts/chat/session-icons` ("mail", "bug", …), stamped by the
    // assistant at spawn to say what the session is for. Nullable (purely
    // additive; unset or unknown renders the monogram fallback) and validated
    // at the application layer like `providerId` — db stays vocabulary-blind.
    icon: text(),
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
    // The context WINDOW (tokens) of the model that produced `lastContextTokens`
    // — the denominator of the meter and of the pressure check, captured at the
    // same write so a later turn on a different model (a delegated small-model
    // pick, a fit-clamped voice turn) cannot silently rewrite the denominator
    // of a chain driven on a 1M model. Null until the first usage report;
    // readers fall back to `contextWindowForModel(model)` (session-hardening
    // arc, 2026-08-19).
    lastContextWindow: integer(),
    // The continuity chain link: the session id this swap segment CONTINUED
    // from, stamped by recordSwapSegmentSession at swap time. Null = chain
    // head. LOOSE ref (no FK) — segments purge independently.
    continuedFromSessionId: text(),
    // ── Per-session composer settings (2026-08-17) ──────────────────
    // What the user CHOSE for this conversation — distinct from `model` above,
    // which records what actually ran. All four are nullable: null = the user
    // never set it on this session (pre-existing rows, channel-born segments),
    // so every reader falls back to its surface default instead of a value no
    // one picked. Written by the settings route (chip changes) and the
    // interactive turn streams (write-through at session resolve); copied
    // forward onto swap segments so a continuity chain keeps its settings.
    sessionMode: text().$type<ChatSessionSelectedMode>(),
    selectedModel: text(),
    thinkingEffort: text().$type<ThinkingEffortLevel>(),
    // The composer's Auto-buildout toggle = AUTOPILOT (Kafi 2026-08-19): when
    // true the turn carries the `autopilot-marker` instruction — the user is
    // probably away, continue alone, set needs_input only when truly stuck.
    // Resolved like the three above (input ?? row ?? default) and inherited by
    // birth-stamped children.
    autoBuildout: boolean(),
    // ── Assistant-set session status (Move 3, 2026-08-17) ───────────
    // The workspaces status trio, per conversation: a FACT with a timestamp
    // ("the assistant set X at T"), never cleared by a write — superseded at
    // READ time by the user's next message (deriveSessionStatus in contracts).
    // Written by `set_session_status` (ambient turn session, the retired set_todos
    // door); copied forward onto swap segments like the composer settings.
    status: text().$type<ChatSessionSetStatus>(),
    statusNote: text(),
    statusSetAt: timestamp(),
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
