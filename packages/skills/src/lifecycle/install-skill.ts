// Installs a Vynel skill at user or workspace scope. Writes the
// SKILL.md + MCP config to disk FIRST (D8 — disk-first ordering),
// then commits the DB row + settings + outbox event atomically
// in a sync transaction.
//
// Throws:
//   - `NotFoundError('skill', skillId)` — not in the catalog
//   - `ValidationError` — initial settings violate schema
//   - `ConflictError` — already installed at the requested scope

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError, ConflictError, ValidationError } from '@vynel/errors'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import * as installedSkillsRepository from '../repositories/index.js'
import * as skillSettingsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { InstalledSkillRow, SkillScope } from '../repositories/index.js'
import { installSkillOnDisk } from '../internal/install-skill-on-disk.js'
import { validateSettingValue } from '../internal/validate-setting-value.js'
import type { ResolvedSkillSettings } from '../settings/resolve-skill-settings.js'
import type { StructuralLogger } from '../skills-types.js'
import { SKILL_INSTALLED, type SkillInstalledPayload } from '../skills-events.js'

export type InstallSkillInput = {
  userId: string
  workspaceId: string
  workspacePath: string
  skillId: string
  scope: SkillScope
  initialSettings?: ResolvedSkillSettings
}

export async function installSkill(
  db: Database,
  input: InstallSkillInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<InstalledSkillRow> {
  // 1. Validate catalog membership.
  const definition = findVerifiedSkillById(input.skillId)
  if (!definition) throw new NotFoundError('skill', input.skillId)

  // 2. Validate initial settings (if provided) against the schema.
  const initialSettings = input.initialSettings ?? {}
  for (const [key, value] of Object.entries(initialSettings)) {
    const schema = definition.settingsSchema.find((s) => s.settingKey === key)
    if (!schema) throw new ValidationError(`Unknown setting ${key} for skill ${input.skillId}`)
    validateSettingValue(schema, value)
  }

  // 3. Detect duplicate at the requested scope.
  const existing = installedSkillsRepository.findInstalledSkillByScope(db, {
    userId: input.userId,
    workspaceId: input.scope === 'workspace' ? input.workspaceId : null,
    skillId: input.skillId,
  })
  if (existing) {
    throw new ConflictError(`Skill ${input.skillId} is already installed at ${input.scope} scope`)
  }

  // 4. Compose resolved settings (defaults + overrides) for the template render.
  const resolved: ResolvedSkillSettings = {}
  for (const schema of definition.settingsSchema) {
    resolved[schema.settingKey] = initialSettings[schema.settingKey] ?? schema.defaultValue
  }

  // 5. FS WRITE FIRST (D8). Failure here = no DB row, no orphan.
  const fsInput: Parameters<typeof installSkillOnDisk>[0] = {
    skillDefinition: definition,
    scope: input.scope,
    resolvedSettings: resolved,
  }
  if (input.scope === 'workspace') fsInput.workspacePath = input.workspacePath
  const { installLocation } = await installSkillOnDisk(fsInput)

  // 6. SYNC tx — row + settings + outbox event co-commit.
  const now = new Date()
  const installedSkillId = randomUUID()
  const installedSkill = withTransaction(db, (tx) => {
    const inserted = installedSkillsRepository.insertInstalledSkill(tx, {
      id: installedSkillId,
      userId: input.userId,
      workspaceId: input.scope === 'workspace' ? input.workspaceId : null,
      skillId: input.skillId,
      scope: input.scope,
      installedFromSource: 'verified-catalog',
      versionInstalled: definition.version,
      installLocation,
      installHealth: 'healthy',
      installHealthMessage: null,
      isEnabled: true,
      installedAt: now,
      updatedAt: now,
    })

    for (const [key, value] of Object.entries(initialSettings)) {
      skillSettingsRepository.upsertSkillSetting(tx, {
        installedSkillId: inserted.id,
        settingKey: key,
        settingValue: JSON.stringify(value),
      })
    }

    const payload: SkillInstalledPayload = {
      installedSkillId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      skillId: inserted.skillId,
      scope: inserted.scope,
      version: inserted.versionInstalled,
      source: inserted.installedFromSource,
      installedAt: inserted.installedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_INSTALLED,
      payload,
      createdAt: now,
      processedAt: null,
    })

    return inserted
  })

  deps.logger?.info(
    { skillId: input.skillId, scope: input.scope, installedSkillId: installedSkill.id },
    'skill installed',
  )
  return installedSkill
}
