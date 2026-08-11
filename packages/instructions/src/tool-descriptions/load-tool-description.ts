import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInstructionsContentDirectory } from '../content-root.js'

// Model-facing TOOL DESCRIPTIONS as editable markdown — the session-instructions
// pattern applied to the prose a tool teaches the model with. Each id maps to
// `packages/instructions/tool-descriptions/<id>.md`; the WHOLE FILE is the
// description, so editing the text re-steers the model with no code change.
// (The description flows into the generated MCP registry — re-run
// `pnpm api:generate` after editing so the wire copy follows.)

export type ToolDescriptionId = 'speak' | 'start_call' | 'end_call' | 'list_calls'

const cache = new Map<ToolDescriptionId, string>()

export function loadToolDescription(id: ToolDescriptionId): string {
  const cached = cache.get(id)
  if (cached !== undefined) return cached

  const filePath = join(resolveInstructionsContentDirectory('tool-descriptions'), `${id}.md`)
  let body: string
  try {
    body = readFileSync(filePath, 'utf8').trim()
  } catch (cause) {
    throw new Error(
      `Tool description "${id}" could not be read from ${filePath}. Every ` +
        'ToolDescriptionId must map to a markdown file in ' +
        'packages/instructions/tool-descriptions/ (the whole file is the description).',
      { cause },
    )
  }
  if (body.length === 0) {
    throw new Error(
      `Tool description "${id}" (${filePath}) is empty — the file body IS the description; it must not be blank.`,
    )
  }

  cache.set(id, body)
  return body
}
