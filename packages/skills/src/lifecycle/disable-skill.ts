// Disables an installed skill. Removes the on-disk SKILL.md + MCP
// entries; flips `isEnabled` to false. Preserves the DB row +
// settings (re-enable rewrites the files from current settings).
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
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { InstalledSkillRow } from '../repositories/index.js'
import { uninstallSkillFromDisk } from '../internal/uninstall-skill-from-disk.js'
import { SKILL_ENABLED_CHANGED, type SkillEnabledChangedPayload } from '../skills-events.js'

export type DisableSkillInput = {
  userId: string
  installedSkillId: string
  workspacePath?: string
}

export async function disableSkill(
  db: Database,
  input: DisableSkillInput,
): Promise<InstalledSkillRow> {
  const row = installedSkillsRepository.findInstalledSkillById(db, input.installedSkillId)
  if (!row || row.userId !== input.userId) {
    throw new NotFoundError('installed-skill', input.installedSkillId)
  }
  if (!row.isEnabled) return row // already disabled — no-op

  // Remove from disk. Per D11 — disable is REAL (files gone),
  // not just a DB flag, so the agent doesn't see the skill.
  const definition = findVerifiedSkillById(row.skillId)
  const fsInput: Parameters<typeof uninstallSkillFromDisk>[0] = {
    installedSkill: row,
    skillDefinition: definition,
  }
  if (input.workspacePath !== undefined) fsInput.workspacePath = input.workspacePath
  await uninstallSkillFromDisk(fsInput)

  const now = new Date()
  const updated = withTransaction(db, (tx) => {
    const next = installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
      isEnabled: false,
    })
    if (!next) throw new Error('disableSkill: row vanished during update')

    const payload: SkillEnabledChangedPayload = {
      installedSkillId: next.id,
      userId: next.userId,
      workspaceId: next.workspaceId,
      skillId: next.skillId,
      isEnabled: false,
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
