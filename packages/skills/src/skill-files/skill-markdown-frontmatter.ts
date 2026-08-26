// The ONE home for a SKILL.md's shape as Vynel writes and checks it: a
// `---` block carrying `name` (the skill's id — Claude Code matches it to
// the folder) and `description` (when Claude reaches for it), then the
// instructions. Flat `key: value` lines only — a full YAML parser would be
// a dependency for two scalars.

import { ValidationError } from '@vynel/errors'

export type SkillMarkdownFrontmatter = {
  name: string | null
  description: string | null
}

export function parseSkillMarkdownFrontmatter(markdown: string): SkillMarkdownFrontmatter {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(withoutBom)
  const fields: Record<string, string> = {}
  for (const line of block?.[1]?.split(/\r?\n/) ?? []) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match !== null) fields[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '')
  }
  return {
    name: fields['name'] && fields['name'].length > 0 ? fields['name'] : null,
    description:
      fields['description'] && fields['description'].length > 0 ? fields['description'] : null,
  }
}

/** A SKILL.md Claude Code will load: `name` must equal the skill's id and a
 *  `description` must be there — without one the skill never triggers. */
export function assertLoadableSkillMarkdown(markdown: string, skillId: string): void {
  const frontmatter = parseSkillMarkdownFrontmatter(markdown)
  if (frontmatter.name !== skillId) {
    throw new ValidationError(
      `SKILL.md must open with a frontmatter block whose \`name\` is "${skillId}" ` +
        '(the folder name) — Claude Code matches the two.',
    )
  }
  if (frontmatter.description === null) {
    throw new ValidationError(
      'SKILL.md needs a `description` in its frontmatter — it is how Claude knows when to use the skill.',
    )
  }
}

export function renderSkillMarkdown(input: {
  skillId: string
  description: string
  body: string
}): string {
  return (
    `---\nname: ${input.skillId}\ndescription: ${JSON.stringify(input.description)}\n---\n\n` +
    `${input.body.replace(/^\s*\n/, '').replace(/\s+$/, '')}\n`
  )
}
