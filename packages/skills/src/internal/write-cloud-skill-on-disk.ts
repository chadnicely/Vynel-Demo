// Writes a CLOUD skill's SKILL.md to disk — the artifact-sourced twin of
// `install-skill-on-disk.ts` (which renders a bundled template). No template
// substitution (v1 cloud skills are settings-free) and no MCP config; the
// content is the verified, extracted SKILL.md. Reuses the same skills-root
// resolution so cloud + bundled skills land in the same `.claude/skills/`.

import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'

// A cloud skillId (=itemId) is remote-sourced catalog metadata; it becomes a
// filesystem path segment below. Restrict it to a safe single segment (the
// hub already publishes kebab itemIds) so a `..`/separator can never escape
// the skills root — defense-in-depth even though the id is trusted metadata.
const SAFE_SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type WriteCloudSkillInput = {
  skillId: string
  scope: SkillScope
  workspacePath?: string // required when scope === 'workspace'
  markdown: string
}

export async function writeCloudSkillOnDisk(
  input: WriteCloudSkillInput,
): Promise<{ installLocation: string }> {
  if (!SAFE_SKILL_ID.test(input.skillId)) {
    throw new ValidationError(`Refusing to install a skill with an unsafe id: ${input.skillId}`)
  }
  const skillsRoot = resolveSkillsRoot(input.scope, input.workspacePath)
  const skillFolder = path.join(skillsRoot, input.skillId)
  const skillMarkdownPath = path.join(skillFolder, 'SKILL.md')

  await mkdir(skillFolder, { recursive: true })
  await writeFile(skillMarkdownPath, input.markdown, 'utf8')

  return { installLocation: skillMarkdownPath }
}
