// Functional repository for the `skill_settings` table. `db` is the
// first argument. Spec: `docs/blueprints/skills/blueprint.md §4.2`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md` + D15.
//
// Tenant isolation is FK-transitive — no `userId` column on this
// table; the parent `installed_skills.userId` carries it. The FK
// cascade on `installedSkillId` means uninstall is a single
// hard-delete on the parent (D13).

import { eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  skillSettings,
  type SkillSettingRow,
  type NewSkillSettingRow,
} from '../schema/skill-settings.js'

export type { SkillSettingRow, NewSkillSettingRow } from '../schema/skill-settings.js'

export function listSettingsForInstalledSkill(
  db: Database,
  installedSkillId: string,
): SkillSettingRow[] {
  return db
    .select()
    .from(skillSettings)
    .where(eq(skillSettings.installedSkillId, installedSkillId))
    .all()
}

export type UpsertSkillSettingInput = {
  installedSkillId: string
  settingKey: string
  // JSON-encoded scalar/object. Encoding is the caller's
  // responsibility (the leaf JSON-encodes; the repo stores
  // text verbatim).
  settingValue: string
}

export function upsertSkillSetting(db: Database, input: UpsertSkillSettingInput): SkillSettingRow {
  const now = new Date()
  const [row] = db
    .insert(skillSettings)
    .values({
      installedSkillId: input.installedSkillId,
      settingKey: input.settingKey,
      settingValue: input.settingValue,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [skillSettings.installedSkillId, skillSettings.settingKey],
      set: { settingValue: input.settingValue, updatedAt: now },
    })
    .returning()
    .all()
  if (!row) {
    throw new Error('upsertSkillSetting: no row returned')
  }
  return row
}

export function deleteAllSettingsForInstalledSkill(db: Database, installedSkillId: string): void {
  db.delete(skillSettings).where(eq(skillSettings.installedSkillId, installedSkillId)).run()
}
