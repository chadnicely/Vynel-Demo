// The `workspace_capabilities` table for the `capabilities` domain — one row
// per (workspace, capability) recording whether that capability is enabled.
// The ENABLE state only — no config column. Per-capability config is typed,
// in the owning domain (knowledge's folder/scope, memory's settings); opaque
// third-party plugin settings reuse the `skills` settings pattern. This keeps
// the spine generic + dodges the JSON-grab-bag the data-standard forbids.
// See `.claude/plans/capability-platform.md` (Gate 1).
//
// Phase 1 SYNC discipline applies (workspaces D19).
//
// `userId` is the tenant boundary (FK → users.id, cascade); every row carries
// it even though Phase 1 has one user, so Phase 2 multi-user is a data-only
// migration. Per data-standard.md "Ownership / identity" + foundation §2 row 9.
//
// `workspaceId` is a hard NOT-NULL FK with `onDelete: 'cascade'` — capabilities
// are ALWAYS workspace-scoped (memory/knowledge are per-workspace; "don't use
// global memory" — user directive 2026-06-20). Unlike `installed_skills` there
// is no user-scope/NULL case, so no partial-unique-index trick is needed.
//
// No `deletedAt` column — disabling flips `isEnabled`; the row is re-creatable
// and carries no audit value. Follows the workspaces D13 / skills "no-restore"
// lineage.

import { table, id, text, timestamp, boolean, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from '../workspaces/workspaces.js'

export const workspaceCapabilities = table(
  'workspace_capabilities',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),

    // Capability identifier — 'memory' / 'knowledge' for first-party (the
    // `capabilities` catalog defines the known set); an arbitrary plugin id for
    // future marketplace capabilities. Open text, like `installed_skills.skillId`.
    capabilityId: text().notNull(),

    isEnabled: boolean().notNull(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    byWorkspace: index('idx_workspace_capabilities_workspace').on(t.workspaceId),
    byUser: index('idx_workspace_capabilities_user').on(t.userId),

    // One enable-state row per (workspace, capability). workspaceId is NOT NULL,
    // so the standard unique index is sufficient (no NULL-distinctness gap).
    uniqueWorkspaceCapability: uniqueIndex('uniq_workspace_capabilities_workspace_capability').on(
      t.workspaceId,
      t.capabilityId,
    ),
  }),
)

export type WorkspaceCapabilityRow = typeof workspaceCapabilities.$inferSelect
export type NewWorkspaceCapabilityRow = typeof workspaceCapabilities.$inferInsert
