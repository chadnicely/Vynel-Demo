// Tests for `discoverClaudeInstalledSkills` — fixture skill dir + a
// missing-directory resilience case. Real end-to-end coverage against the
// user's actually-installed skills is the step-27 smoke test.
// See `docs/blueprints/providers/blueprint.md §11.5` + `§17.9`.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { discoverClaudeInstalledSkills } from './discover-claude-installed-skills.js'

const workspacePath = join(tmpdir(), `vynel-skills-test-${randomUUID()}`)

beforeAll(async () => {
  const skillDirectory = join(workspacePath, '.claude', 'skills', 'email-drafter')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    '---\nname: email-drafter\ndescription: Drafts emails\n---\n\n# Email Drafter\n',
  )
})

afterAll(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('discoverClaudeInstalledSkills', () => {
  it('discovers a workspace-scope skill from its SKILL.md frontmatter', async () => {
    const skills = await discoverClaudeInstalledSkills({ workspacePath })
    expect(skills).toContainEqual({
      providerId: 'claude',
      scope: 'workspace',
      skillName: 'email-drafter',
      displayDescription: 'Drafts emails',
      installLocation: join(workspacePath, '.claude', 'skills', 'email-drafter', 'SKILL.md'),
      invocationSyntax: '/email-drafter',
    })
  })

  it('returns an array without throwing when the workspace has no skills directory', async () => {
    const skills = await discoverClaudeInstalledSkills({
      workspacePath: join(tmpdir(), `vynel-nonexistent-${randomUUID()}`),
    })
    expect(Array.isArray(skills)).toBe(true)
  })
})
