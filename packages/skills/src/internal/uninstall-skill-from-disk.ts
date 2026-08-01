// Removes a skill's on-disk folder + cleans MCP config entries.
// Idempotent — re-call after a successful uninstall returns
// silently. Per coding.md §1.2 (only filesystem writer for these
// paths). Used by `uninstallSkill` (hard removal — the only way a
// skill leaves disk since install/uninstall-only, 2026-08-01).

import path from 'node:path'
import { rm } from 'node:fs/promises'
import type { InstalledSkillRow } from '../repositories/index.js'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { updateMcpServersForScope } from './update-mcp-servers-for-scope.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'

export type UninstallSkillFromDiskInput = {
  installedSkill: InstalledSkillRow
  // `null` for `external` skills (not in the catalog) — MCP
  // cleanup is skipped because we don't know what the skill
  // installed.
  skillDefinition: VerifiedSkillDefinition | null
  workspacePath?: string
}

export async function uninstallSkillFromDisk(input: UninstallSkillFromDiskInput): Promise<void> {
  const skillsRoot = resolveSkillsRoot(input.installedSkill.scope, input.workspacePath)
  const skillFolder = path.join(skillsRoot, input.installedSkill.skillId)

  // Best-effort folder removal — sync still works if the folder is
  // already gone (e.g., disable then uninstall, or external removal
  // surfaced via `synchronizeSkillsWithProvider`).
  try {
    await rm(skillFolder, { recursive: true, force: true })
  } catch {
    // Permission failure or unexpected error — row deletion still
    // succeeds; sync will reconcile on next run.
  }

  if (input.skillDefinition && input.skillDefinition.requiredMcpServers.length > 0) {
    // exactOptionalPropertyTypes: true — conditional assembly.
    const mcpInput: Parameters<typeof updateMcpServersForScope>[0] = {
      scope: input.installedSkill.scope,
      serversToAdd: [],
      serversToRemove: input.skillDefinition.requiredMcpServers.map((s) => s.serverName),
    }
    if (input.workspacePath !== undefined) mcpInput.workspacePath = input.workspacePath
    await updateMcpServersForScope(mcpInput)
  }
}
