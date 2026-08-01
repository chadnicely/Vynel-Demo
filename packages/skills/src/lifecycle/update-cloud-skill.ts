// Updates an installed cloud skill to a newer catalog version — the missing
// third lifecycle op between install and uninstall (claude-official arc:
// official items make catalog staleness real). Same trust order as
// `install-cloud-skill.ts`:
//   1. VERIFY sha256(bytes) — nothing untrusted is parsed or written.
//   2. Extract SKILL.md from the (now-trusted) archive.
//   3. Overwrite the disk file FIRST (D8), then patch the row + outbox in
//      one sync tx.
// Re-running with the row's current version is allowed on purpose — it
// doubles as a REPAIR (rewrites a missing/drifted file and resets
// `installHealth` to healthy).
//
// Throws: ValidationError (sha mismatch / bad archive / missing workspace
// path), NotFoundError (row missing or another user's — no enumeration leak).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as installedSkillsRepository from '../repositories/index.js'
import type { InstalledSkillRow } from '../repositories/index.js'
import { extractSkillArchive } from '../internal/extract-skill-archive.js'
import { verifyArtifactSha256 } from '../internal/verify-artifact-sha256.js'
import { writeCloudSkillOnDisk } from '../internal/write-cloud-skill-on-disk.js'
import type { StructuralLogger } from '../skills-types.js'
import { SKILL_UPDATED, type SkillUpdatedPayload } from '../skills-events.js'

export type UpdateCloudSkillInput = {
  userId: string
  installedSkillId: string
  // Required when the row's scope is 'workspace' — its disk home lives
  // under the workspace. Ignored for a user-scope row.
  workspacePath: string | null
  artifactBytes: Buffer
  expectedSha256: string
  version: string
}

export async function updateCloudSkill(
  db: Database,
  input: UpdateCloudSkillInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<InstalledSkillRow> {
  // 1. Integrity check FIRST — never parse/write unverified bytes.
  verifyArtifactSha256(input.artifactBytes, input.expectedSha256, 'update')

  // 2. Extract the full folder from the verified archive. The writer's
  //    stage-and-swap also drops files the new version no longer ships.
  const { markdown, resources } = await extractSkillArchive(input.artifactBytes)

  // 3. Tenant-isolated lookup (the uninstall precedent).
  const row = installedSkillsRepository.findInstalledSkillById(db, input.installedSkillId)
  if (!row || row.userId !== input.userId) {
    throw new NotFoundError('installed-skill', input.installedSkillId)
  }
  if (row.scope === 'workspace' && input.workspacePath === null) {
    throw new ValidationError(
      `Updating ${row.skillId} needs its workspace path — call from the workspace surface that installed it.`,
    )
  }
  // 4. FS OVERWRITE FIRST (D8) — failure here leaves the old row intact.
  const writeInput: Parameters<typeof writeCloudSkillOnDisk>[0] = {
    skillId: row.skillId,
    scope: row.scope,
    markdown,
    resources,
  }
  if (row.scope === 'workspace') writeInput.workspacePath = input.workspacePath as string
  const { installLocation } = await writeCloudSkillOnDisk(writeInput)

  // 5. SYNC tx — row patch + outbox co-commit. The bytes on disk are now
  // marketplace-sourced regardless of how the row was first installed.
  const now = new Date()
  const previousVersion = row.versionInstalled
  const updated = withTransaction(db, (tx) => {
    const patched = installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
      versionInstalled: input.version,
      installLocation,
      installedFromSource: 'marketplace',
      installHealth: 'healthy',
      installHealthMessage: null,
    })
    if (!patched) {
      throw new NotFoundError('installed-skill', input.installedSkillId)
    }

    const payload: SkillUpdatedPayload = {
      installedSkillId: patched.id,
      userId: patched.userId,
      workspaceId: patched.workspaceId,
      skillId: patched.skillId,
      scope: patched.scope,
      previousVersion,
      version: patched.versionInstalled,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })

    return patched
  })

  deps.logger?.info(
    { skillId: updated.skillId, installedSkillId: updated.id, version: updated.versionInstalled },
    'cloud skill updated',
  )
  return updated
}
