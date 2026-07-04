// Re-enables a previously disabled skill. Rewrites the on-disk
// SKILL.md from current settings; flips `isEnabled` to true.
// Per D11.
//
// Throws:
//   - `NotFoundError('installed-skill', id)` — row missing OR
//     owned by a different user.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import * as installedSkillsRepository from '../repositories/index.js'
import * as skillSettingsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { InstalledSkillRow } from '../repositories/index.js'
import { installSkillOnDisk } from '../internal/install-skill-on-disk.js'
import { resolveSkillSettings } from '../settings/resolve-skill-settings.js'
import { SKILL_ENABLED_CHANGED, type SkillEnabledChangedPayload } from '../skills-events.js'

export type EnableSkillInput = {
  userId: string
  installedSkillId: string
  workspacePath?: string
}

export async function enableSkill(
  db: Database,
  input: EnableSkillInput,
): Promise<InstalledSkillRow> {
  const row = installedSkillsRepository.findInstalledSkillById(db, input.installedSkillId)
  if (!row || row.userId !== input.userId) {
    throw new NotFoundError('installed-skill', input.installedSkillId)
  }
  if (row.isEnabled) return row // already enabled — no-op

  // Re-install on disk using current resolved settings.
  const definition = findVerifiedSkillById(row.skillId)
  if (definition) {
    const stored = skillSettingsRepository.listSettingsForInstalledSkill(db, row.id)
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

  const now = new Date()
  const updated = withTransaction(db, (tx) => {
    const next = installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
      isEnabled: true,
    })
    if (!next) throw new Error('enableSkill: row vanished during update')

    const payload: SkillEnabledChangedPayload = {
      installedSkillId: next.id,
      userId: next.userId,
      workspaceId: next.workspaceId,
      skillId: next.skillId,
      isEnabled: true,
      changedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_ENABLED_CHANGED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return next
  })

  return updated
}
