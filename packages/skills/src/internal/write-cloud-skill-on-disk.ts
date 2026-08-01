// Writes a CLOUD skill's full folder (SKILL.md + resources) to disk — the
// artifact-sourced twin of `install-skill-on-disk.ts` (which renders a
// bundled template). No template substitution (cloud skills are
// settings-free) and no MCP config; the content is the verified, extracted
// archive. Reuses the same skills-root resolution so cloud + bundled skills
// land in the same `.claude/skills/`.
//
// STAGE-AND-SWAP: entries land in `.claude/.skills-staging/` — a SIBLING of
// the skills root, same volume (rename stays cheap) but OUTSIDE the scanned
// tree, so a crash orphan can never be discovered as a skill or ingested by
// the provider sync as a phantom row. The swap itself is rename-first: the
// old folder is moved aside (atomic) before the new one moves in, so even a
// mid-swap failure preserves one complete version — never a half-written
// skill the agent could read.

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import type { SkillArchiveResource } from './extract-skill-archive.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'

// A cloud skillId (=itemId) is remote-sourced catalog metadata; it becomes a
// filesystem path segment below. Restrict it to a safe single segment (the
// hub already publishes kebab itemIds) so a `..`/separator can never escape
// the skills root — defense-in-depth even though the id is trusted metadata.
const SAFE_SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Windows: rm can transiently fail on files held open by AV/indexers.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3 } as const

export type WriteCloudSkillInput = {
  skillId: string
  scope: SkillScope
  workspacePath?: string // required when scope === 'workspace'
  markdown: string
  resources: SkillArchiveResource[]
}

export async function writeCloudSkillOnDisk(
  input: WriteCloudSkillInput,
): Promise<{ installLocation: string }> {
  if (!SAFE_SKILL_ID.test(input.skillId)) {
    throw new ValidationError(`Refusing to install a skill with an unsafe id: ${input.skillId}`)
  }
  const skillsRoot = resolveSkillsRoot(input.scope, input.workspacePath)
  const skillFolder = path.join(skillsRoot, input.skillId)
  const stagingRoot = path.join(path.dirname(skillsRoot), '.skills-staging')
  const stagingFolder = path.join(stagingRoot, `${input.skillId}-${randomUUID()}`)
  const retiredFolder = path.join(stagingRoot, `retired-${input.skillId}-${randomUUID()}`)

  try {
    await mkdir(stagingFolder, { recursive: true })
    await writeFile(path.join(stagingFolder, 'SKILL.md'), input.markdown, 'utf8')
    for (const resource of input.resources) {
      // The extractor already validated these paths; re-assert containment
      // here because this file is the only filesystem writer for the skills
      // roots and must stay safe under any caller.
      const destination = path.join(stagingFolder, resource.relativePath)
      if (!destination.startsWith(stagingFolder + path.sep)) {
        throw new ValidationError(
          `Refusing to write outside the skill folder: ${resource.relativePath}`,
        )
      }
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, resource.bytes)
    }
    await mkdir(skillsRoot, { recursive: true })
    // Move the previous version ASIDE (atomic) rather than deleting it in
    // place — a failure after this point still leaves one complete version
    // recoverable, and the retired copy sits outside the scanned tree.
    try {
      await rename(skillFolder, retiredFolder)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(stagingFolder, skillFolder)
  } catch (error) {
    await rm(stagingFolder, RM_OPTIONS).catch(() => undefined)
    throw error
  }
  // Post-swap tidy: both are best-effort — a leftover here is invisible to
  // discovery (outside the scanned root) and swept by the next write.
  await rm(retiredFolder, RM_OPTIONS).catch(() => undefined)

  return { installLocation: path.join(skillFolder, 'SKILL.md') }
}
