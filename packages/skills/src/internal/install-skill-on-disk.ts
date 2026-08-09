// Writes a skill's SKILL.md + updates MCP config on disk. The
// ONLY filesystem writer for `.claude/skills/` paths per
// coding.md §1.2.
//
// The disk-write happens BEFORE the DB transaction in
// `installSkill` (D8 — disk-first ordering). If this throws, no
// DB row exists. If this succeeds and the DB write fails, the
// on-disk files are orphans recoverable via
// `synchronizeSkillsWithProvider` (which discovers them as
// `installedFromSource: 'external'`).

import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { SkillScope } from '../repositories/index.js'
import { renderSkillMarkdownTemplate } from './render-skill-markdown-template.js'
import { updateMcpServersForScope } from './update-mcp-servers-for-scope.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'
import type { ResolvedSkillSettings } from '../settings/resolve-skill-settings.js'

export type InstallSkillOnDiskInput = {
  skillDefinition: VerifiedSkillDefinition
  scope: SkillScope
  workspacePath?: string // required when scope === 'workspace'
  resolvedSettings: ResolvedSkillSettings
}

export type InstallSkillOnDiskResult = {
  installLocation: string // absolute path to the SKILL.md
}

export async function installSkillOnDisk(
  input: InstallSkillOnDiskInput,
): Promise<InstallSkillOnDiskResult> {
  const skillsRoot = resolveSkillsRoot(input.scope, input.workspacePath)
  const skillFolder = path.join(skillsRoot, input.skillDefinition.skillId)
  const skillMarkdownPath = path.join(skillFolder, 'SKILL.md')

  await mkdir(skillFolder, { recursive: true })

  const rendered = renderSkillMarkdownTemplate(
    input.skillDefinition.skillMarkdownTemplate,
    input.resolvedSettings,
  )
  await writeFile(skillMarkdownPath, rendered, 'utf8')

  if (input.skillDefinition.requiredMcpServers.length > 0) {
    // exactOptionalPropertyTypes: true — assemble conditionally
    // rather than passing `workspacePath: undefined` (which the
    // type would reject). Pattern locked at MEMORY 2026-05-21
    // architectural precedent.
    const installedAt = new Date().toISOString()
    const mcpInput: Parameters<typeof updateMcpServersForScope>[0] = {
      scope: input.scope,
      serversToAdd: input.skillDefinition.requiredMcpServers.map((server) => ({
        server,
        provenance: { itemId: input.skillDefinition.skillId, installedAt },
      })),
      serversToRemove: [],
    }
    if (input.workspacePath !== undefined) mcpInput.workspacePath = input.workspacePath
    // A refused addition means another item (or the user) already owns a
    // server with that name — the skill still works against the existing
    // entry, so the install proceeds; the foreign entry is not ours to
    // replace (shared-server ownership stays with its first installer).
    await updateMcpServersForScope(mcpInput)
  }

  return { installLocation: skillMarkdownPath }
}
