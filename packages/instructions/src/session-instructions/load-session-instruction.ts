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
import { join } from 'node:path'
import { resolveInstructionsContentDirectory } from '../content-root.js'

// Each id maps to `<id>.md` in the content directory — the filename IS the
// specification of which session the instruction governs. `voice-turn-marker`
// is the per-MESSAGE sibling of `voice-turn`: the same directive re-stated on
// the turn's provider input, because on a long root session the system-prompt
// block decays under conversational momentum — recency wins. `autopilot-marker`
// is the per-message directive for a session whose `autoBuildout` setting is on
// (Kafi 2026-08-19: "Claude needs to know he is on autopilot — the user is
// probably not available; continue by yourself; if stuck, set needs_input").
// `schedule-fire-marker` frames a FIRED schedule prompt as the scheduler
// speaking (2026-08-20: an unframed fire read as the user asking, so the model
// asked back and set a sleep timer) — it carries `{{scheduleName}}` /
// `{{firedAtLocal}}` placeholders, filled by `renderScheduleFireMarker`.
// `turn-time-marker` states the user's current wall clock on every interactive
// turn (a model reads no clock) — `{{nowLocal}}` / `{{timezone}}`, filled by
// `renderTurnTimeMarker`.
export type SessionInstructionId =
  | 'global-root'
  | 'workspace-agent'
  | 'voice-turn'
  | 'voice-turn-marker'
  | 'autopilot-marker'
  | 'schedule-fire-marker'
  | 'turn-time-marker'

const cache = new Map<SessionInstructionId, string>()

export function loadSessionInstruction(id: SessionInstructionId): string {
  const cached = cache.get(id)
  if (cached !== undefined) return cached

  const filePath = join(resolveInstructionsContentDirectory('session-instructions'), `${id}.md`)
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
