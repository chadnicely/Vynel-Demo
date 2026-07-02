// `discoverClaudeInstalledSkills` — scans the Claude runtime's skill
// locations on disk and returns the `InstalledSkill[]` it finds. Resilient:
// a missing directory yields no skills, never an error.
//
// Scopes covered: user (`~/.claude/skills/<name>/SKILL.md`) and workspace
// (`<workspace>/.claude/skills/<name>/SKILL.md`). Plugin-scope skills live
// under `~/.claude/plugins/` with a different layout — deferred (Implement
// note; no Phase 1 consumer needs them yet).
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  DiscoverSkillsInput,
  InstalledSkill,
  SkillScope,
} from '../../shared/installed-skill.js'

export async function discoverClaudeInstalledSkills(
  input: DiscoverSkillsInput,
): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = []

  skills.push(...(await scanSkillsDirectory(path.join(os.homedir(), '.claude', 'skills'), 'user')))

  if (input.workspacePath !== undefined) {
    skills.push(
      ...(await scanSkillsDirectory(
        path.join(input.workspacePath, '.claude', 'skills'),
        'workspace',
      )),
    )
  }

  return skills
}

async function scanSkillsDirectory(
  skillsDirectory: string,
  scope: SkillScope,
): Promise<InstalledSkill[]> {
  let entries: string[]
  try {
    entries = await readdir(skillsDirectory)
  } catch {
    return [] // directory absent — no skills at this scope
  }

  const skills: InstalledSkill[] = []
  for (const entry of entries) {
    const skillMarkdownPath = path.join(skillsDirectory, entry, 'SKILL.md')
    let content: string
    try {
      if (!(await stat(path.join(skillsDirectory, entry))).isDirectory()) {
        continue
      }
      content = await readFile(skillMarkdownPath, 'utf8')
    } catch {
      continue // not a skill directory, or no SKILL.md inside it
    }

    const frontmatter = parseFrontmatter(content)
    const skillName = frontmatter['name'] ?? entry
    skills.push({
      providerId: 'claude',
      scope,
      skillName,
      displayDescription: frontmatter['description'] ?? null,
      installLocation: skillMarkdownPath,
      invocationSyntax: `/${skillName}`,
    })
  }
  return skills
}

// Minimal YAML-frontmatter reader — SKILL.md frontmatter is flat `key: value`
// lines, so a full YAML parser is not warranted.
function parseFrontmatter(markdown: string): Record<string, string> {
  const blockMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (blockMatch === null) {
    return {}
  }
  const fields: Record<string, string> = {}
  for (const line of blockMatch[1]!.split(/\r?\n/)) {
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (fieldMatch !== null) {
      fields[fieldMatch[1]!] = fieldMatch[2]!.trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return fields
}
