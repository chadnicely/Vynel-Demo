// Updates the per-installation settings of an installed skill.
// Validates every value against the catalog schema, persists the
// upserts atomically with an outbox event, then re-renders the
// on-disk SKILL.md from the new resolved settings IF the skill
// is currently enabled.
//
// Throws:
//   - `NotFoundError('installed-skill', id)` — row missing OR
//     owned by a different user.
//   - `NotFoundError('skill', skillId)` — the row's `skillId` is
//     no longer in the catalog (e.g. an external skill or a
//     catalog removal in a future release).
//   - `ValidationError` — a new value violates schema constraints.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import * as installedSkillsRepository from '../repositories/index.js'
import * as skillSettingsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { installSkillOnDisk } from '../internal/install-skill-on-disk.js'
import { validateSettingValue } from '../internal/validate-setting-value.js'
import { resolveSkillSettings, type ResolvedSkillSettings } from './resolve-skill-settings.js'
import { SKILL_SETTINGS_UPDATED, type SkillSettingsUpdatedPayload } from '../skills-events.js'

export type UpdateSkillSettingsInput = {
  userId: string
  installedSkillId: string
  workspacePath?: string
  newSettings: Partial<ResolvedSkillSettings>
}

export async function updateSkillSettings(
  db: Database,
  input: UpdateSkillSettingsInput,
): Promise<ResolvedSkillSettings> {
  const row = installedSkillsRepository.findInstalledSkillById(db, input.installedSkillId)
  if (!row || row.userId !== input.userId) {
    throw new NotFoundError('installed-skill', input.installedSkillId)
  }
  const definition = findVerifiedSkillById(row.skillId)
  if (!definition) {
    throw new NotFoundError('skill', row.skillId)
  }

  // Validate every new value.
  for (const [key, value] of Object.entries(input.newSettings)) {
    const schema = definition.settingsSchema.find((s) => s.settingKey === key)
    if (!schema) throw new ValidationError(`Unknown setting ${key} for skill ${row.skillId}`)
    validateSettingValue(schema, value)
  }

  // Persist (sync tx) + emit outbox event.
  const now = new Date()
  const changedKeys = Object.keys(input.newSettings)
  withTransaction(db, (tx) => {
    for (const [key, value] of Object.entries(input.newSettings)) {
      skillSettingsRepository.upsertSkillSetting(tx, {
        installedSkillId: input.installedSkillId,
        settingKey: key,
        settingValue: JSON.stringify(value),
      })
    }

    const payload: SkillSettingsUpdatedPayload = {
      installedSkillId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      skillId: row.skillId,
      changedSettingKeys: changedKeys,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_SETTINGS_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  // If enabled, re-render SKILL.md from the new resolved settings.
  if (row.isEnabled) {
    const stored = skillSettingsRepository.listSettingsForInstalledSkill(db, input.installedSkillId)
    const resolved = resolveSkillSettings(definition, stored)
    const fsInput: Parameters<typeof installSkillOnDisk>[0] = {
      skillDefinition: definition,
      scope: row.scope,
      resolvedSettings: resolved,
    }
    if (row.scope === 'workspace' && input.workspacePath !== undefined) {
      fsInput.workspacePath = input.workspacePath
    }
    await installSkillOnDisk(fsInput)
  }

  const final = skillSettingsRepository.listSettingsForInstalledSkill(db, input.installedSkillId)
  return resolveSkillSettings(definition, final)
}
