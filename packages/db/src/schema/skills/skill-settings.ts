// The `skill_settings` table for the `skills` domain — per-
// installation key/value setting store. Composite PK on
// (installedSkillId, settingKey); JSON-encoded values.
//
// See `docs/blueprints/skills/blueprint.md §3.2` + `decisions.md`
// D5 (schema in catalog, values in DB) + D6 (JSON-encoded values
// pattern from users D3).
//
// Phase 1 SYNC discipline applies (D15).
//
// **No `userId` column.** Tenant isolation is FK-transitive via
// `installedSkillId → installed_skills.userId → users.id`.
// Memory D23 / data-standard "Tenant isolation by repo-layer
// convention". A redundant `userId` here risks divergence from
// the parent.
//
// The `onDelete: 'cascade'` on the parent FK means uninstall is a
// single hard-delete on `installed_skills` — settings cascade
// without a separate purge. Locked at D13.

import { table, id, text, timestamp, primaryKey } from '@vynel/db/dialect'
import { installedSkills } from './installed-skills.js'

export const skillSettings = table(
  'skill_settings',
  {
    installedSkillId: id()
      .notNull()
      .references(() => installedSkills.id, { onDelete: 'cascade' }),
    settingKey: text().notNull(),
    // JSON-encoded scalar/object — `resolveSkillSettings` decodes
    // against the catalog's `SkillSettingSchema.type`. Same pattern
    // as `user_preferences.preferenceValue` (users D3).
    settingValue: text().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.installedSkillId, t.settingKey] }),
  }),
)

export type SkillSettingRow = typeof skillSettings.$inferSelect
export type NewSkillSettingRow = typeof skillSettings.$inferInsert
