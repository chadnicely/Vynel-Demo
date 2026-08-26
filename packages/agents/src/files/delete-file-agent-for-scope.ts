// Deletes one HAND-AUTHORED agent file on the user's explicit say-so — the
// shelf's delete on an "On disk" row and the `delete_agent_file` tool. A
// Vynel mirror is refused (that agent is deleted through `delete_agent`,
// which drops the row AND the file); a missing file is a 404.

import { readFile, rm } from 'node:fs/promises'
import { ConflictError, NotFoundError } from '@vynel/errors'
import type { AgentScope } from '../agents-types.js'
import { parseAgentFile } from './agent-file-frontmatter.js'
import { resolveAgentFilePath } from './resolve-agent-files-root.js'

export type DeleteFileAgentForScopeInput = {
  scope: AgentScope
  workspacePath?: string
  slug: string
}

export async function deleteFileAgentForScope(input: DeleteFileAgentForScopeInput): Promise<void> {
  const filePath = resolveAgentFilePath(input.scope, input.slug, input.workspacePath)
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('agent file', input.slug)
    }
    throw err
  }
  if (parseAgentFile(content).isManagedMirror) {
    throw new ConflictError(
      `'${input.slug}.md' is a file Vynel manages for one of its own agents — delete the agent ` +
        'in the agents panel instead.',
    )
  }
  await rm(filePath, { force: true })
}
