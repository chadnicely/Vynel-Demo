// Removes a skill's on-disk folder + cleans MCP config entries.
// Idempotent — re-call after a successful uninstall returns
// silently. Per coding.md §1.2 (only filesystem writer for these
// paths). Used by `uninstallSkill` (hard removal — the only way a
// skill leaves disk since install/uninstall-only, 2026-08-01).
//
// The folder comes from the row's `installLocation`, never from
// `<root>/<skillId>` — an external row's skillId is its frontmatter name,
// which need not be the folder name (the 2026-08-26 audit found the
// recomputed path deleting nothing while the row vanished).

import { rm } from 'node:fs/promises'
import type { InstalledSkillRow } from '../repositories/index.js'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { updateMcpServersForScope } from './update-mcp-servers-for-scope.js'
import { resolveInstalledSkillFolder } from './resolve-installed-skill-folder.js'

export type UninstallSkillFromDiskInput = {
  installedSkill: InstalledSkillRow
  // `null` for `external` skills (not in the catalog) — MCP
  // cleanup is skipped because we don't know what the skill
  // installed.
  skillDefinition: VerifiedSkillDefinition | null
  workspacePath?: string
}

export async function uninstallSkillFromDisk(input: UninstallSkillFromDiskInput): Promise<void> {
  // Containment is asserted BEFORE anything is removed — a row pointing
  // outside the skills root throws rather than deleting elsewhere.
  const skillFolder = resolveInstalledSkillFolder(input.installedSkill, input.workspacePath)

  // Best-effort folder removal — sync still works if the folder is
  // already gone (e.g., external removal surfaced via
  // `synchronizeSkillsWithProvider`).
  try {
    await rm(skillFolder, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    // Permission failure or unexpected error — row deletion still
    // succeeds; sync will reconcile on next run.
  }

  if (input.skillDefinition && input.skillDefinition.requiredMcpServers.length > 0) {
    // exactOptionalPropertyTypes: true — conditional assembly.
    // Marker-guarded: only entries THIS skill installed are removed — an
    // unmarked (hand-added, or pre-marker) or other-item entry survives,
    // matching the best-effort posture of the folder removal above.
    const mcpInput: Parameters<typeof updateMcpServersForScope>[0] = {
      scope: input.installedSkill.scope,
      serversToAdd: [],
      serversToRemove: input.skillDefinition.requiredMcpServers.map((s) => ({
        serverName: s.serverName,
        onlyIfProvenanceItemId: input.installedSkill.skillId,
      })),
    }
    if (input.workspacePath !== undefined) mcpInput.workspacePath = input.workspacePath
    await updateMcpServersForScope(mcpInput)
  }
}
