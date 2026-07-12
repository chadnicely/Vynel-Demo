// Installs a skill downloaded from the cloud marketplace. The artifact-sourced
// twin of `install-skill.ts` (which renders a bundled catalog template). Order:
//   1. VERIFY sha256(bytes) against the catalog's recorded hash — integrity
//      FIRST, so nothing untrusted is ever parsed or written (M4a's SHA is the
//      trust anchor; a mismatch means tampered/corrupt bytes).
//   2. Extract SKILL.md from the (now-trusted) archive.
//   3. Disk-write FIRST (D8 ordering), then the DB row + outbox in one sync tx.
// Records `installedFromSource: 'marketplace'` + the cloud version.
//
// Throws: ValidationError (sha mismatch / bad archive), ConflictError (already
// installed at scope).

import { createHash, randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { ConflictError, ValidationError } from '@vynel/errors'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as installedSkillsRepository from '../repositories/index.js'
import type { InstalledSkillRow, SkillScope } from '../repositories/index.js'
import { extractSkillMarkdown } from '../internal/extract-skill-markdown.js'
import { requireWorkspaceInstallBinding } from '../internal/require-workspace-install-binding.js'
import { writeCloudSkillOnDisk } from '../internal/write-cloud-skill-on-disk.js'
import type { StructuralLogger } from '../skills-types.js'
import { SKILL_INSTALLED, type SkillInstalledPayload } from '../skills-events.js'

export type InstallCloudSkillInput = {
  userId: string
  // null = a user-scope install with no workspace in play (the GLOBAL
  // marketplace surface). A 'workspace' scope REQUIRES both non-null.
  workspaceId: string | null
  workspacePath: string | null
  itemId: string
  scope: SkillScope
  artifactBytes: Buffer
  expectedSha256: string
  version: string
}

export async function installCloudSkill(
  db: Database,
  input: InstallCloudSkillInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<InstalledSkillRow> {
  // 0. A workspace-scope install must carry its workspace binding.
  const workspaceBinding =
    input.scope === 'workspace' ? requireWorkspaceInstallBinding(input) : null

  // 1. Integrity check FIRST — never parse/write unverified bytes.
  //    Lowercase both sides: digest('hex') emits lowercase, but a hub
  //    record may carry uppercase hex — casing must never fail a valid hash.
  const actualSha256 = createHash('sha256').update(input.artifactBytes).digest('hex')
  if (actualSha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
    throw new ValidationError(
      'The downloaded skill failed its integrity check (sha256 mismatch) — install aborted.',
    )
  }

  // 2. Extract the SKILL.md from the verified archive.
  const markdown = await extractSkillMarkdown(input.artifactBytes)

  // 3. Duplicate detection at the requested scope. Cloud skills use
  //    `skillId === itemId` (as bundled items already do).
  const existing = installedSkillsRepository.findInstalledSkillByScope(db, {
    userId: input.userId,
    workspaceId: workspaceBinding?.workspaceId ?? null,
    skillId: input.itemId,
  })
  if (existing) {
    throw new ConflictError(`${input.itemId} is already installed at ${input.scope} scope`)
  }

  // 4. FS WRITE FIRST (D8) — failure here = no DB row, no orphan.
  const writeInput: Parameters<typeof writeCloudSkillOnDisk>[0] = {
    skillId: input.itemId,
    scope: input.scope,
    markdown,
  }
  if (workspaceBinding !== null) writeInput.workspacePath = workspaceBinding.workspacePath
  const { installLocation } = await writeCloudSkillOnDisk(writeInput)

  // 5. SYNC tx — row + outbox co-commit.
  const now = new Date()
  const installedSkill = withTransaction(db, (tx) => {
    const inserted = installedSkillsRepository.insertInstalledSkill(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: workspaceBinding?.workspaceId ?? null,
      skillId: input.itemId,
      scope: input.scope,
      installedFromSource: 'marketplace',
      versionInstalled: input.version,
      installLocation,
      installHealth: 'healthy',
      installHealthMessage: null,
      isEnabled: true,
      installedAt: now,
      updatedAt: now,
    })

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
    { itemId: input.itemId, scope: input.scope, installedSkillId: installedSkill.id },
    'cloud skill installed',
  )
  return installedSkill
}
