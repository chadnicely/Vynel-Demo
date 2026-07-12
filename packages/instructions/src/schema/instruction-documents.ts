// The `instruction_documents` table for the `instructions` domain — one row
// per USER-AUTHORED guidance document. Two retrieval modes share the shape
// (the primitives differ in RETRIEVAL, not in columns — see
// `docs/module-notes/instructions-notebook.md` "The two primitives"):
//   - 'notebook' — a book: on-demand reference material the model opens via
//     the `vynel-notebook` read tools when a matching task starts.
//   - 'always'   — RESERVED for the deferred always-injected instructions arc
//     (scope change 2026-07-12: "implement all in instructions later"). The
//     column ships now so that arc needs no migration; NO op or read in this
//     slice writes or lists 'always' rows.
//
// Verified (team-shipped) notebooks NEVER live here — they ship from the
// repo directory `packages/instructions/notebooks/` and are immutable
// everywhere (Chad's settled fork #2).
//
// `workspaceId` is a nullable FK → workspaces.id (cascade) — 'global' docs
// carry null; a workspace-scoped doc dies with its workspace. `workspaces` is
// a KERNEL hub table, so every table-owning leaf FKs it directly (loose refs
// are only for sibling-LEAF targets).

import { table, id, text, boolean, integer, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// 'global' docs ride every scope; 'workspace' docs only their workspace's
// turns. App-enforced (no DB CHECK) like every other union column.
export type InstructionScope = 'global' | 'workspace'

// See the file header — 'always' is reserved for the deferred instructions arc.
export type InstructionMode = 'always' | 'notebook'

export const instructionDocuments = table(
  'instruction_documents',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),

    scope: text().$type<InstructionScope>().notNull(),
    // Null for 'global' scope. Uses `text().references(...)` since `id()` is
    // NOT NULL by dialect contract (the onboarding-runs nullable-FK precedent).
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),

    mode: text().$type<InstructionMode>().notNull().default('notebook'),

    title: text().notNull(),
    // Markdown; capped at the op layer (50k chars) so a runaway paste can't
    // balloon the table.
    body: text().notNull(),

    enabled: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    // The list read filters (userId, mode) then narrows by scope/workspace.
    byUserMode: index('idx_instruction_documents_user_mode').on(t.userId, t.mode),
    byWorkspace: index('idx_instruction_documents_workspace').on(t.workspaceId),
  }),
)

export type InstructionDocument = typeof instructionDocuments.$inferSelect
export type NewInstructionDocument = typeof instructionDocuments.$inferInsert
