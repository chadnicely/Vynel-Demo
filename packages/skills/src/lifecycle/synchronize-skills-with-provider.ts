// Reconciles Vynel's `installed_skills` rows with what the
// provider sees on disk. Runs at workspace-open + user-triggered
// "Refresh skills" — never on a timer (D12).
//
// Three outcomes per row / per discovered skill:
//   - On-disk + in-DB                   → installHealth = 'healthy'
//   - In-DB only (file removed manually) → installHealth = 'missing-on-disk'
//   - On-disk only (raw-CLI install)     → insert as `external` source
//
// Idempotent — re-running with no new disk activity is a no-op
// beyond touching `installHealth` to the same value.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import * as installedSkillsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { AiAgentProvider } from '@vynel/providers'
import type { StructuralLogger } from '../skills-types.js'
import { checkInstallLocationExists } from '../internal/check-install-location-exists.js'
import { SKILL_INSTALLED, type SkillInstalledPayload } from '../skills-events.js'

export type SynchronizeSkillsWithProviderInput = {
  userId: string
  workspaceId: string
  workspacePath: string
  provider: AiAgentProvider // injected for testability
}

export type SynchronizeSkillsResult = {
  healthyCount: number
  missingOnDiskCount: number
  externalDiscoveredCount: number
}

export async function synchronizeSkillsWithProvider(
  db: Database,
  input: SynchronizeSkillsWithProviderInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<SynchronizeSkillsResult> {
  const providerSkills = await input.provider.discoverInstalledSkills({
    workspacePath: input.workspacePath,
  })

  const stats: SynchronizeSkillsResult = {
    healthyCount: 0,
    missingOnDiskCount: 0,
    externalDiscoveredCount: 0,
  }

  const installedRows = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })

  // FS reads happen OUTSIDE the transaction (the sync tx body cannot
  // await). Compute presence first; commit the resulting state +
  // outbox events atomically below. Code-reviewer C4 (2026-05-25).
  const presenceByRowId = new Map<string, boolean>()
  for (const row of installedRows) {
    presenceByRowId.set(row.id, await checkInstallLocationExists(row.installLocation))
  }

  const knownLocations = new Set(installedRows.map((r) => r.installLocation))
  const externalCandidates = providerSkills.filter((p) => !knownLocations.has(p.installLocation))

  // SYNC tx — every reconciliation update + every external-discovery
  // insert + every outbox emit co-commits atomically. A partial
  // failure rolls back all of it.
  const now = new Date()
  withTransaction(db, (tx) => {
    // 1. Reconcile DB rows against on-disk reality.
    for (const row of installedRows) {
      const onDisk = presenceByRowId.get(row.id) === true
      if (onDisk) {
        stats.healthyCount += 1
        installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
          installHealth: 'healthy',
          installHealthMessage: null,
        })
      } else {
        stats.missingOnDiskCount += 1
        installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
          installHealth: 'missing-on-disk',
          installHealthMessage: 'SKILL.md file no longer exists at install location',
        })
      }
    }

    // 2. Insert + announce external skills (on disk, not in our DB).
    for (const providerSkill of externalCandidates) {
      // Map provider's scope union ('user' | 'workspace' | 'plugin')
      // to skills' union ('user' | 'workspace'); roll plugin → workspace.
      const scope = providerSkill.scope === 'user' ? 'user' : 'workspace'
      const inserted = installedSkillsRepository.insertInstalledSkill(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: scope === 'workspace' ? input.workspaceId : null,
        skillId: providerSkill.skillName,
        scope,
        installedFromSource: 'external',
        versionInstalled: 'unknown',
        installLocation: providerSkill.installLocation,
        installHealth: 'healthy',
        installHealthMessage: null,
        isEnabled: true,
        installedAt: now,
        updatedAt: now,
      })

      // Emit a `skill.installed` outbox event for the external row
      // (per D16 publish-from-day-one; consumers care about install
      // events regardless of source). Code-reviewer C4.
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
      stats.externalDiscoveredCount += 1
    }
  })

  deps.logger?.info(stats, 'skills synchronized with provider')
  return stats
}
