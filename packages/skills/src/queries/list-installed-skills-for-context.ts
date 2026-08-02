// Returns the installed-skills + their catalog definitions + their
// resolved settings, joined for the given user+workspace context.
//
// Phase 1 SYNC — pure-DB read; no transaction needed. Per blueprint
// §5.3.

import type { Database } from '@vynel/db'
import * as installedSkillsRepository from '../repositories/index.js'
import * as skillSettingsRepository from '../repositories/index.js'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveSkillSettings, type ResolvedSkillSettings } from '../settings/resolve-skill-settings.js'

export type ListInstalledSkillsForContextInput = {
  userId: string
  // null = user-scope rows only — the GLOBAL skills view has no workspace
  // to union in (mirrors the repo's null convention).
  workspaceId: string | null
}

export type InstalledSkillWithDefinitionAndSettings = {
  installedSkill: InstalledSkillRow
  // `null` for `external` skills (discovered on disk but not in the
  // bundled catalog).
  definition: VerifiedSkillDefinition | null
  resolvedSettings: ResolvedSkillSettings
}

export function listInstalledSkillsForContext(
  db: Database,
  input: ListInstalledSkillsForContextInput,
): InstalledSkillWithDefinitionAndSettings[] {
  const rows = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, input)
  return rows.map((installedSkill) => {
    const definition = findVerifiedSkillById(installedSkill.skillId)
    const storedSettings = skillSettingsRepository.listSettingsForInstalledSkill(
      db,
      installedSkill.id,
    )
    const resolvedSettings = definition ? resolveSkillSettings(definition, storedSettings) : {}
    return { installedSkill, definition, resolvedSettings }
  })
}
