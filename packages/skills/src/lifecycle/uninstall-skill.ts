// Uninstalls a Vynel skill. Removes the on-disk SKILL.md + MCP
// entries, then hard-deletes the DB row (FK cascade purges
// settings). INSTANT hard-delete per D13 — no soft-delete cycle.
//
// Throws:
//   - `NotFoundError('installed-skill', id)` — row missing OR
//     owned by a different user (no enumeration leak).
//   - `ForbiddenError` — the skill is `isSystemInstalled: true`.
//     Disable is allowed; uninstall is not. (No Phase 1 instance
//     after `workspace-context`'s A2 removal — see the guard note.)

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError, ForbiddenError } from '@vynel/errors'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import * as installedSkillsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { uninstallSkillFromDisk } from '../internal/uninstall-skill-from-disk.js'
import type { StructuralLogger } from '../skills-types.js'
import { SKILL_UNINSTALLED, type SkillUninstalledPayload } from '../skills-events.js'

export type UninstallSkillInput = {
  userId: string
  installedSkillId: string
  workspacePath?: string
}

export async function uninstallSkill(
  db: Database,
  input: UninstallSkillInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<void> {
  // 1. Tenant-isolated lookup.
  const row = installedSkillsRepository.findInstalledSkillById(db, input.installedSkillId)
  if (!row || row.userId !== input.userId) {
    throw new NotFoundError('installed-skill', input.installedSkillId)
  }

  // 2. System-installed skills cannot be uninstalled (only disabled).
  // Retained mechanism (skills D3): Phase 1 has NO system-installed skill
  // after `workspace-context`'s A2 removal, so this guard is currently
  // dormant — it fires again the moment a future bundle sets the flag.
  const definition = findVerifiedSkillById(row.skillId)
  if (definition?.isSystemInstalled) {
    throw new ForbiddenError(`Skill ${row.skillId} is system-installed and cannot be uninstalled`)
  }

  // 3. FS uninstall first (idempotent; ignores missing folder).
  const fsInput: Parameters<typeof uninstallSkillFromDisk>[0] = {
    installedSkill: row,
    skillDefinition: definition,
  }
  if (input.workspacePath !== undefined) fsInput.workspacePath = input.workspacePath
  await uninstallSkillFromDisk(fsInput)

  // 4. SYNC tx — row delete (cascades settings) + outbox event.
  const now = new Date()
  withTransaction(db, (tx) => {
    installedSkillsRepository.hardDeleteInstalledSkill(tx, row.id, input.userId)

    const payload: SkillUninstalledPayload = {
      installedSkillId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      skillId: row.skillId,
      scope: row.scope,
      uninstalledAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_UNINSTALLED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ skillId: row.skillId, installedSkillId: row.id }, 'skill uninstalled')
}
