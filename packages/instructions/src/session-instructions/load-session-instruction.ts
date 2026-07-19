// The always-on SESSION INSTRUCTIONS — the identity/operating prompts appended
// to a turn's system prompt. They live as editable markdown at the package root
// (`packages/instructions/session-instructions/<id>.md`): the WHOLE FILE is the
// prompt, so opening one and editing the text changes how that scope behaves,
// with no code change. This is the `notebooks/` precedent (repo-shipped .md read
// from disk, cached for the process lifetime, fail-loud on a missing/empty file)
// applied to the prompts that used to be TypeScript string literals in
// `@vynel/session/runtime`.
//
// Reached through the dedicated `@vynel/instructions/session-instructions`
// subpath (the `@vynel/asks/mcp` split precedent) so a consumer that only needs
// the prompt STRING — `@vynel/session` — pulls this filesystem loader ALONE,
// never the notebook MCP descriptor's SDK-builder graph.
//
// LOAD-BEARING: `global-root.md` drives LLM-native routing — the model calls the
// routing tools only because the prompt names them. The colocated test guards
// those names; do not weaken it.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Each id maps to `<id>.md` in the content directory — the filename IS the
// specification of which session the instruction governs.
export type SessionInstructionId = 'global-root' | 'workspace-agent' | 'voice-turn'

const here = dirname(fileURLToPath(import.meta.url))
// src/session-instructions/ (or dist/… once compiled) → packages/instructions/session-instructions/
const CONTENT_DIRECTORY = resolve(here, '../../session-instructions')

const cache = new Map<SessionInstructionId, string>()

export function loadSessionInstruction(id: SessionInstructionId): string {
  const cached = cache.get(id)
  if (cached !== undefined) return cached

  const filePath = join(CONTENT_DIRECTORY, `${id}.md`)
  let body: string
  try {
    body = readFileSync(filePath, 'utf8').trim()
  } catch (cause) {
    throw new Error(
      `Session instruction "${id}" could not be read from ${filePath}. Every ` +
        'SessionInstructionId must map to a markdown file in ' +
        'packages/instructions/session-instructions/ (the whole file is the prompt).',
      { cause },
    )
  }
  if (body.length === 0) {
    throw new Error(
      `Session instruction "${id}" (${filePath}) is empty — the file body IS the prompt; it must not be blank.`,
    )
  }

  cache.set(id, body)
  return body
}
