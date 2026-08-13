// `phases` table for the `phases` domain — one row per phase of a workspace's
// engineering build plan ("how the app gets built"). A phase is a big-form
// narrative document (`description` carries the full write-up, far larger than
// a plan's detail) with a position in the build order and a status the agent
// moves as the build progresses. Work items that BUILD a phase are `features`
// rows carrying a loose `phaseId` ref back here. Has NO `deletedAt`:
// `deletePhase` hard-deletes (docs/module-notes/phases.md).
//
// WORKSPACE-SCOPED (NOT NULL workspaceId — the workspace_apps narrowing
// precedent): an engineering plan describes ONE project's build, and only
// workspaces are projects — there is no meaningful global phase.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary. `sessionId` is a
// LOOSE `text()` cross-domain ref (NO FK). Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// The tasks/plans status vocabulary, deliberately shared — one status
// language across every work-tracking surface.
export type PhaseStatus = 'open' | 'in-progress' | 'done'

export const phases = table(
  'phases',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    // The big-form body — the phase IS its write-up (up to
    // PHASE_DESCRIPTION_MAX_LENGTH; list responses carry a preview only).
    description: text().notNull(),
    // The position in the build order (0-based). Created phases append;
    // update_phase moves one explicitly when the plan is reshaped.
    orderIndex: integer().notNull(),
    status: text().$type<PhaseStatus>().notNull(),
    // Loose cross-domain ref — the chat session whose turn created the phase
    // (NOT a FK).
    sessionId: text(),
    completedAt: timestamp(), // stamped on → 'done'; cleared when reopened
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    workspaceOrderIdx: index('idx_phases_workspace_order').on(t.workspaceId, t.orderIndex),
    userWorkspaceIdx: index('idx_phases_user_workspace').on(t.userId, t.workspaceId),
  }),
)

export type Phase = typeof phases.$inferSelect
export type NewPhase = typeof phases.$inferInsert
