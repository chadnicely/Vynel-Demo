// Reconciles Vynel's `installed_skills` rows with what the provider sees on
// disk. Runs on EVERY skills list read (the shelf is always right — a folder
// the user dropped in by hand shows up the moment they look) and on the
// explicit `POST /synchronize`; never on a timer (D12).
//
// Three outcomes per row / per discovered skill:
//   - On-disk + in-DB                   → installHealth = 'healthy'
//   - In-DB only (file removed manually) → installHealth = 'missing-on-disk'
//   - On-disk only (raw-CLI install)     → insert as `external` source
//
// Idempotent — and, because it rides a read path, a re-run with nothing
// changed writes NOTHING (a row's health is only touched when it differs
// from what disk says), and NO disk state can make it throw: a second
// folder carrying a name a row already holds (a copied folder with its
// frontmatter left alone, a renamed folder the row still points at by its
// old path) is skipped with a warning rather than tripping the unique
// index and taking every shelf read down with it.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { withTransaction, type Database } from '@vynel/db'
import * as installedSkillsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { AiAgentProvider, InstalledSkill } from '@vynel/providers'
import type { InstallHealth } from '../repositories/index.js'
import type { StructuralLogger } from '../skills-types.js'
import { checkInstallLocationExists } from '../internal/check-install-location-exists.js'
import { resolveHostHomeDir } from '../internal/resolve-host-home-dir.js'
import { SKILL_INSTALLED, type SkillInstalledPayload } from '../skills-events.js'

export type SynchronizeSkillsWithProviderInput = {
  userId: string
  // null = the GLOBAL surface: only the user-scope rows and the user's own
  // skills folder are reconciled (there is no workspace to look into).
  workspaceId: string | null
  workspacePath: string | null
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
  // The user scope is wherever the skills leaf says home is — the same seam
  // every skills writer uses, so tests and production agree on the folder.
  const providerSkills = await input.provider.discoverInstalledSkills({
    userHomeDir: resolveHostHomeDir(),
    ...(input.workspacePath === null ? {} : { workspacePath: input.workspacePath }),
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

  const externalCandidates = selectExternalCandidates(
    providerSkills,
    installedRows,
    input.workspaceId,
    deps.logger,
  )

  // SYNC tx — every reconciliation update + every external-discovery
  // insert + every outbox emit co-commits atomically. A partial
  // failure rolls back all of it.
  const now = new Date()
  withTransaction(db, (tx) => {
    // 1. Reconcile DB rows against on-disk reality — writing only on change.
    for (const row of installedRows) {
      const onDisk = presenceByRowId.get(row.id) === true
      const health: InstallHealth = onDisk ? 'healthy' : 'missing-on-disk'
      if (onDisk) stats.healthyCount += 1
      else stats.missingOnDiskCount += 1
      if (row.installHealth === health) continue
      installedSkillsRepository.updateInstalledSkill(tx, row.id, input.userId, {
        installHealth: health,
        installHealthMessage: onDisk ? null : 'SKILL.md file no longer exists at install location',
      })
    }

    // 2. Insert + announce external skills (on disk, not in our DB).
    for (const candidate of externalCandidates) {
      const inserted = installedSkillsRepository.insertInstalledSkill(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: candidate.scope === 'workspace' ? input.workspaceId : null,
        skillId: candidate.skillName,
        scope: candidate.scope,
        installedFromSource: 'external',
        versionInstalled: 'unknown',
        installLocation: candidate.installLocation,
        installHealth: 'healthy',
        installHealthMessage: null,
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

  if (stats.externalDiscoveredCount > 0 || stats.missingOnDiskCount > 0) {
    deps.logger?.info(stats, 'skills synchronized with provider')
  }
  return stats
}

type ExternalCandidate = {
  scope: 'user' | 'workspace'
  skillName: string
  installLocation: string
}

// A discovered skill becomes a row only when nothing already claims its
// LOCATION or its NAME at that scope — the unique index is
// (user, workspace|null, skillId), so a second folder with the same
// frontmatter name has no row it can honestly become.
function selectExternalCandidates(
  providerSkills: InstalledSkill[],
  installedRows: readonly { installLocation: string; scope: string; skillId: string }[],
  workspaceId: string | null,
  logger?: StructuralLogger,
): ExternalCandidate[] {
  const knownLocations = new Set(installedRows.map((row) => normalizeLocation(row.installLocation)))
  const claimedNames = new Set(installedRows.map((row) => `${row.scope}:${row.skillId}`))
  const candidates: ExternalCandidate[] = []
  for (const providerSkill of providerSkills) {
    // Map provider's scope union ('user' | 'workspace' | 'plugin') to
    // skills' union ('user' | 'workspace'); roll plugin → workspace.
    const scope = providerSkill.scope === 'user' ? 'user' : 'workspace'
    // Without a workspace in play a workspace-scope discovery has no row
    // to become — the provider is not asked for one, but stay strict.
    if (scope === 'workspace' && workspaceId === null) continue
    if (knownLocations.has(normalizeLocation(providerSkill.installLocation))) continue
    const nameKey = `${scope}:${providerSkill.skillName}`
    if (claimedNames.has(nameKey)) {
      logger?.warn(
        { skillName: providerSkill.skillName, scope, installLocation: providerSkill.installLocation },
        'skill folder skipped — another folder already holds that name at this scope',
      )
      continue
    }
    claimedNames.add(nameKey)
    candidates.push({ scope, skillName: providerSkill.skillName, installLocation: providerSkill.installLocation })
  }
  return candidates
}

// Windows paths compare case-insensitively; a home dir reported with
// different casing between install time and now must not read as a new
// location.
function normalizeLocation(location: string): string {
  const resolved = path.resolve(location)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
