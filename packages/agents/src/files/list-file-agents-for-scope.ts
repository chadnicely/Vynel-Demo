// SYNC read of the HAND-AUTHORED agent files in a scope's `.claude/agents/`
// folder — the ones Vynel did not write. They are live in every session
// (the SDK's `settingSources` loads them) yet had no row, no shelf entry
// and no door until 2026-08-26. Vynel's own mirrors (the managed marker)
// are skipped: those ARE the DB rows the shelf already lists. Lenient
// throughout — a missing folder or unreadable file contributes nothing.
// Files whose stem the writers could not address are left out too.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isSafeFileStem } from '@vynel/contracts/fs/safe-file-stem'
import type { AgentScope } from '../agents-types.js'
import { parseAgentFile } from './agent-file-frontmatter.js'
import { resolveAgentFilesRoot } from './resolve-agent-files-root.js'

export type FileAgentForScope = {
  /** The file stem — how the doors address it. */
  slug: string
  fileName: string
  /** Frontmatter `name` (what Claude Code calls it), or the stem. */
  name: string
  description: string | null
  tools: string[] | null
  model: string | null
  /** The whole file — powers the raw editor. */
  content: string
  /** The system prompt after the frontmatter block — the row's preview. */
  body: string
}

export function listFileAgentsForScope(
  scope: AgentScope,
  workspacePath?: string,
): FileAgentForScope[] {
  const root = resolveAgentFilesRoot(scope, workspacePath)
  let fileNames: string[]
  try {
    fileNames = readdirSync(root)
      .filter((fileName) => fileName.endsWith('.md'))
      .filter((fileName) => isSafeFileStem(fileName.slice(0, -'.md'.length)))
      .sort()
  } catch {
    return []
  }
  const agents: FileAgentForScope[] = []
  for (const fileName of fileNames) {
    let content: string
    try {
      content = readFileSync(path.join(root, fileName), 'utf8')
    } catch {
      continue
    }
    const fileAgent = toFileAgent(fileName, content)
    if (fileAgent !== null) agents.push(fileAgent)
  }
  return agents
}

/** One hand-authored agent file by slug; `null` when missing, unreadable,
 *  unaddressable — or a Vynel mirror (which the rows answer for). */
export function readFileAgentForScope(
  scope: AgentScope,
  slug: string,
  workspacePath?: string,
): FileAgentForScope | null {
  if (!isSafeFileStem(slug)) return null
  const fileName = `${slug}.md`
  try {
    const content = readFileSync(path.join(resolveAgentFilesRoot(scope, workspacePath), fileName), 'utf8')
    return toFileAgent(fileName, content)
  } catch {
    return null
  }
}

function toFileAgent(fileName: string, content: string): FileAgentForScope | null {
  const parts = parseAgentFile(content)
  if (parts.isManagedMirror) return null
  const slug = fileName.slice(0, -'.md'.length)
  return {
    slug,
    fileName,
    name: parts.name ?? slug,
    description: parts.description,
    tools: parts.tools,
    model: parts.model,
    content,
    body: parts.body,
  }
}
