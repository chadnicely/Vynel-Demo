// Functional repository for the `installed_skills` table. `db` is the
// first argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/skills/blueprint.md §4.1`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md` + D15.
//
// `find*` returns null on missing; `get*` (none exposed here) would
// throw. Typed throws happen at the core boundary per
// `.claude/rules/error-handling.md` "Layering" — repos throw only
// plain `Error` for internal-invariant violations (e.g. `.returning()`
// empty).

import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  installedSkills,
  type InstalledSkillRow,
  type NewInstalledSkillRow,
} from '../schema/installed-skills.js'

export type {
  InstalledSkillRow,
  NewInstalledSkillRow,
  SkillScope,
  InstalledFromSource,
  InstallHealth,
} from '../schema/installed-skills.js'

export function findInstalledSkillById(
  db: Database,
  installedSkillId: string,
): InstalledSkillRow | null {
  const [row] = db
    .select()
    .from(installedSkills)
    .where(eq(installedSkills.id, installedSkillId))
    .limit(1)
    .all()
  return row ?? null
}

export type FindInstalledSkillByScopeInput = {
  userId: string
  // null = look up the user-scope row; non-null = look up the
  // workspace-scope row for that workspace.
  workspaceId: string | null
  skillId: string
}

export function findInstalledSkillByScope(
  db: Database,
  input: FindInstalledSkillByScopeInput,
): InstalledSkillRow | null {
  const workspaceClause =
    input.workspaceId === null
      ? isNull(installedSkills.workspaceId)
      : eq(installedSkills.workspaceId, input.workspaceId)

  const [row] = db
    .select()
    .from(installedSkills)
    .where(
      and(
        eq(installedSkills.userId, input.userId),
        workspaceClause,
        eq(installedSkills.skillId, input.skillId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type ListInstalledSkillsForUserAndWorkspaceInput = {
  userId: string
  // null = user-scope rows ONLY (the global marketplace surface has no
  // workspace to union in) — mirrors `findInstalledSkillByScope`'s null
  // convention above.
  workspaceId: string | null
}

export function listInstalledSkillsForUserAndWorkspace(
  db: Database,
  input: ListInstalledSkillsForUserAndWorkspaceInput,
): InstalledSkillRow[] {
  // With a workspaceId: the union of user-scope rows (workspaceId IS
  // NULL) + workspace-scope rows for THIS workspace. Phase 1 list size
  // is bounded by the catalog count + any external skills the user
  // installed via raw Claude Code — small in practice.
  const workspaceClause =
    input.workspaceId === null
      ? isNull(installedSkills.workspaceId)
      : or(isNull(installedSkills.workspaceId), eq(installedSkills.workspaceId, input.workspaceId))
  return db
    .select()
    .from(installedSkills)
    .where(and(eq(installedSkills.userId, input.userId), workspaceClause))
    .orderBy(desc(installedSkills.installedAt))
    .all()
}

export function insertInstalledSkill(
  db: Database,
  newRow: NewInstalledSkillRow,
): InstalledSkillRow {
  const [inserted] = db.insert(installedSkills).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertInstalledSkill: no row returned')
  }
  return inserted
}

export type InstalledSkillPatch = Partial<
  Omit<InstalledSkillRow, 'id' | 'userId' | 'workspaceId' | 'skillId' | 'installedAt'>
>

// Mutating repo functions encode the tenant filter (`userId`) in the
// WHERE clause per `data-standard.md` "Tenant isolation by repo-layer
// convention" — a missing filter is review-blocking. Callers pass the
// caller's `userId`; cross-tenant rows match nothing → return null /
// false, which the leaf translates to `NotFoundError` (no
// enumeration leak per error-handling.md). Code-reviewer C3
// (2026-05-25).

export function updateInstalledSkill(
  db: Database,
  installedSkillId: string,
  userId: string,
  patch: InstalledSkillPatch,
): InstalledSkillRow | null {
  const [updated] = db
    .update(installedSkills)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(installedSkills.id, installedSkillId), eq(installedSkills.userId, userId)))
    .returning()
    .all()
  return updated ?? null
}

export function hardDeleteInstalledSkill(
  db: Database,
  installedSkillId: string,
  userId: string,
): boolean {
  const deleted = db
    .delete(installedSkills)
    .where(and(eq(installedSkills.id, installedSkillId), eq(installedSkills.userId, userId)))
    .returning()
    .all()
  return deleted.length > 0
}
