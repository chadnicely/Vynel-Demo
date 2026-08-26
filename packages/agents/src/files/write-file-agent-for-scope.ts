// Writes one HAND-AUTHORED agent file — the raw editor's save and the
// `write_agent_file` tool. The file is the record for these (no row); a
// Vynel-managed agent lives in the DB and is edited there, so this door
// refuses a path that holds a Vynel mirror (ConflictError → "edit it in
// the agents panel") and a slug that already names a Vynel agent at the
// scope (the row would shadow the file while enabled and un-shadow it on
// disable — two definitions, one name, no honest answer). The content must
// be a file Claude Code will load: frontmatter with `name` = the file stem
// and a `description`.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from '@vynel/db'
import { ConflictError, ValidationError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { AgentScope } from '../agents-types.js'
import { parseAgentFile } from './agent-file-frontmatter.js'
import { resolveAgentFilePath } from './resolve-agent-files-root.js'

export const MAX_AGENT_FILE_LENGTH = 100_000

export type WriteFileAgentForScopeInput = {
  userId: string
  scope: AgentScope
  workspaceId: string | null
  workspacePath?: string
  slug: string
  content: string
}

export async function writeFileAgentForScope(
  db: Database,
  input: WriteFileAgentForScopeInput,
): Promise<{ filePath: string }> {
  const filePath = resolveAgentFilePath(input.scope, input.slug, input.workspacePath)
  const content = normalizeAgentFileContent(input.content, input.slug)

  const row = agentsRepository.findAgentBySlug(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    slug: input.slug,
  })
  if (row) {
    throw new ConflictError(
      `'${input.slug}' is already an agent in Vynel at ${input.scope} scope — edit it in the ` +
        'agents panel (or with update_agent) instead of writing a file.',
    )
  }

  const existing = await readExisting(filePath)
  if (existing !== null && parseAgentFile(existing).isManagedMirror) {
    throw new ConflictError(
      `'${input.slug}.md' is a file Vynel manages for one of its own agents — edit the agent ` +
        'in the agents panel instead.',
    )
  }

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')

  // A Vynel agent created at this slug between the check above and the
  // write now owns the path (its mirror was just overwritten): back out,
  // the way createAgent removes its own mirror on a lost race.
  const raced = agentsRepository.findAgentBySlug(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    slug: input.slug,
  })
  if (raced) {
    await rm(filePath, { force: true })
    throw new ConflictError(
      `'${input.slug}' became a Vynel agent while this file was being written — edit it in the agents panel.`,
    )
  }
  return { filePath }
}

function normalizeAgentFileContent(raw: string, slug: string): string {
  const content = raw.replace(/\s+$/, '')
  if (content.length === 0) {
    throw new ValidationError('An agent file needs content — a frontmatter block and a system prompt.')
  }
  if (content.length > MAX_AGENT_FILE_LENGTH) {
    throw new ValidationError(`An agent file is capped at ${MAX_AGENT_FILE_LENGTH} characters.`)
  }
  const parts = parseAgentFile(content)
  if (parts.name !== slug) {
    throw new ValidationError(
      `The file must open with a frontmatter block whose \`name\` is "${slug}" (the file name) — ` +
        'Claude Code matches the two.',
    )
  }
  if (parts.description === null) {
    throw new ValidationError(
      'The frontmatter needs a `description` — it is how Claude knows when to delegate to this agent.',
    )
  }
  if (parts.body.trim().length === 0) {
    throw new ValidationError('The agent needs a system prompt after the frontmatter block.')
  }
  if (parts.isManagedMirror) {
    throw new ValidationError('That content carries the Vynel mirror marker — write your own file.')
  }
  return `${content}\n`
}

async function readExisting(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
