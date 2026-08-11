// `features` table for the `features` domain — one row per feature the
// workspace's app should have. Like a phase, a feature is a big-form
// narrative document (`description` carries the full write-up); unlike
// phases, features are an unordered catalog. `phaseId` is a LOOSE `text()`
// ref to the phase that builds this feature (the tasks.planId precedent —
// sibling leaves, NO FK; a deleted phase leaves it dangling harmlessly).
// Has NO `deletedAt`: `deleteFeature` hard-deletes
// (docs/module-notes/features.md).
//
// WORKSPACE-SCOPED (NOT NULL workspaceId — the phases/workspace_apps
// narrowing): a feature describes ONE project's app.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary. `sessionId` is a
// LOOSE `text()` cross-domain ref (NO FK). Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// The tasks/plans/phases status vocabulary, deliberately shared.
export type FeatureStatus = 'open' | 'in-progress' | 'done'

export const features = table(
  'features',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    // The big-form body — the feature IS its write-up (up to
    // FEATURE_DESCRIPTION_MAX_LENGTH; list responses carry a preview only).
    description: text().notNull(),
    // Loose cross-domain ref — the build-plan phase that delivers this
    // feature (NOT a FK; nullable = not yet placed in a phase).
    phaseId: text(),
    status: text().$type<FeatureStatus>().notNull(),
    // Loose cross-domain ref — the chat session whose turn created the
    // feature (NOT a FK).
    sessionId: text(),
    completedAt: timestamp(), // stamped on → 'done'; cleared when reopened
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_features_user_workspace').on(t.userId, t.workspaceId),
    phaseIdx: index('idx_features_phase').on(t.phaseId),
  }),
)

export type Feature = typeof features.$inferSelect
export type NewFeature = typeof features.$inferInsert
