// The `installed_skills` table for the `skills` domain — one row
// per skill installed in a user-scope (workspaceId NULL) or
// workspace-scope. See `docs/blueprints/skills/blueprint.md §3.1`
// + `decisions.md` D9 (NULL-for-user-scope unique-index trick).
//
// Phase 1 SYNC discipline applies (D15).
//
// `userId` is the tenant boundary (FK → users.id, cascade); every
// row carries it even though Phase 1 has one user, so Phase 2
// multi-user is a data-only migration. Per data-standard.md
// "Ownership / identity" + foundation §2 row 9 + §11 #14.
//
// `workspaceId` is a hard FK with `onDelete: 'cascade'` — when a
// workspace is hard-deleted (workspaces D13), its workspace-scoped
// skill rows go with it; the on-disk `<workspacePath>/.claude/
// skills/` folder cascades when the workspace folder is removed.
//
// No `deletedAt` column — uninstall is INSTANT hard-delete + FK
// cascade on skill_settings. Locked at D13 (user-affirmed at gate:
// "deleted instantly"). Departure from chat/memory/approvals
// soft-delete default; follows workspaces D13 / knowledge D13
// "no-restore product story" lineage (installed_skills rows are
// 100% re-creatable by re-installing — no audit retention value).

import { sql } from 'drizzle-orm'
import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type SkillScope = 'user' | 'workspace'

export type InstalledFromSource =
  | 'verified-catalog' // installed from Vynel's Verified pack
  | 'marketplace' // Phase 1.5: installed from cloud marketplace
  | 'external' // user installed via raw Claude Code outside Vynel
  | 'user' // written in Vynel's own skill editor (or by Claude via create_skill)

export type InstallHealth =
  | 'healthy' // files present, MCP servers configured, all good
  | 'missing-on-disk' // row exists but files don't (user removed externally)
  | 'mcp-config-drift' // SKILL.md present but MCP config mismatch
  | 'failed-install' // install errored partway; needs retry

export const installedSkills = table(
  'installed_skills',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // NULLABLE FK — null = user-scope (row is available across every
    // workspace the user owns). Non-null = workspace-scope (only that
    // workspace). Uses `text()` rather than `id()` because `id()`
    // returns a NOT NULL column by dialect contract; nullable FKs use
    // `text().references(...)` per the precedent in
    // `approvals/approval-requests.ts:77` (autoApprovedByRuleId).
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),

    // Catalog identifier for `verified-catalog` / `marketplace` sources
    // (e.g. 'email-drafter'); the provider-reported skill name for
    // `external` sources (whatever the user's raw Claude Code install
    // named it).
    skillId: text().notNull(),
    scope: text().$type<SkillScope>().notNull(),
    installedFromSource: text().$type<InstalledFromSource>().notNull(),

    // Catalog version (semver) at install time. Surfaces "Update
    // available" in the marketplace card when catalog > installed.
    versionInstalled: text().notNull(),

    // Absolute path to the SKILL.md the installer wrote. Lets sync
    // verify presence via `fs.access()` without recomputing the path.
    installLocation: text().notNull(),

    // On-disk reality, refreshed on `synchronizeSkillsWithProvider`.
    // Default `healthy` is the optimistic post-install state.
    installHealth: text().$type<InstallHealth>().notNull(),
    installHealthMessage: text(),

    installedAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    byUser: index('idx_installed_skills_user').on(t.userId),
    byWorkspace: index('idx_installed_skills_workspace').on(t.workspaceId),

    // Cross-scope coexistence: the 3-column unique index permits a
    // user-scope row (workspaceId NULL) + a workspace-scope row
    // (workspaceId non-null) for the same (userId, skillId). SQLite
    // treats NULL as distinct from non-NULL here, which is the
    // semantic we want.
    uniqueUserWorkspaceSkill: uniqueIndex('uniq_installed_skills_user_workspace_skill').on(
      t.userId,
      t.workspaceId,
      t.skillId,
    ),

    // Same-scope user-side dup-detection: the standard SQL semantic
    // (also SQLite + Postgres default) treats two NULLs as DISTINCT
    // in a unique index — the 3-col index above does NOT catch two
    // user-scope rows with the same (userId, skillId). A PARTIAL
    // unique index covering ONLY the user-scope subset
    // (`WHERE workspace_id IS NULL`) closes the gap. Same expression
    // works in Postgres Phase 2 — `partialUniqueIndex` dialect helper
    // remains a foundation-hardening item for when the Postgres
    // branch needs a typed wrapper; for Phase 1 the drizzle
    // `.where(sql\`…\`)` builder is sufficient.
    //
    // D9 originally claimed SQLite's NULL semantics caught this case
    // natively — empirically incorrect (surfaced at repo-test TDD
    // 2026-05-25); this index is the corrective fix.
    uniqueUserScopeSkill: uniqueIndex('uniq_installed_skills_user_scope_skill')
      .on(t.userId, t.skillId)
      .where(sql`${t.workspaceId} IS NULL`),
  }),
)

export type InstalledSkillRow = typeof installedSkills.$inferSelect
export type NewInstalledSkillRow = typeof installedSkills.$inferInsert
