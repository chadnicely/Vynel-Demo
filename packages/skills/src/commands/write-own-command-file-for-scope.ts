// Writes one of the user's OWN slash commands into a scope's
// `.claude/commands/` folder — the create AND edit door for the Commands
// view and the `write_command` tool (config-is-truth: the file is the
// record). Takes the command's PARTS rather than a raw file so a person's
// form and Claude's call share one renderer, and any frontmatter key a
// hand-authored file already carried (`allowed-tools`, `model`…) is read
// back from disk and written out again — a save never drops it.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { parseCommandFile, renderCommandFile } from './command-file-frontmatter.js'
import { resolveCommandFilePath } from './resolve-commands-root.js'

export const MAX_COMMAND_BODY_LENGTH = 50_000
export const MAX_COMMAND_DESCRIPTION_LENGTH = 300
export const MAX_COMMAND_ARGUMENT_HINT_LENGTH = 120

export type WriteOwnCommandFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  commandName: string
  description?: string | null
  argumentHint?: string | null
  body: string
}

export async function writeOwnCommandFileForScope(
  input: WriteOwnCommandFileForScopeInput,
): Promise<{ filePath: string }> {
  const filePath = resolveCommandFilePath(input.scope, input.commandName, input.workspacePath)
  const body = input.body.replace(/\s+$/, '')
  if (body.length === 0) {
    throw new ValidationError('A command needs a prompt — write what Claude should do when it runs.')
  }
  if (body.length > MAX_COMMAND_BODY_LENGTH) {
    throw new ValidationError(
      `A command file is capped at ${MAX_COMMAND_BODY_LENGTH} characters — split it in two.`,
    )
  }

  const existing = await readExistingCommandFile(filePath)
  const content = renderCommandFile({
    description: normalizeScalar(input.description, MAX_COMMAND_DESCRIPTION_LENGTH, 'description'),
    argumentHint: normalizeScalar(
      input.argumentHint,
      MAX_COMMAND_ARGUMENT_HINT_LENGTH,
      'argument hint',
    ),
    extraFrontmatterLines: existing === null ? [] : parseCommandFile(existing).extraFrontmatterLines,
    body,
  })

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { filePath }
}

async function readExistingCommandFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// A frontmatter scalar is one line: a newline would end the value and start
// a key of its own (the agent-mirror lesson), so it is refused outright.
function normalizeScalar(
  value: string | null | undefined,
  maxLength: number,
  label: string,
): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) return null
  if (/[\r\n]/.test(trimmed)) {
    throw new ValidationError(`The ${label} must be a single line.`)
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`The ${label} is capped at ${maxLength} characters.`)
  }
  return trimmed
}
