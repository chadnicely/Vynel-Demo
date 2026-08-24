// `composeSessionInstruction` — the per-session identity stack: one BASE (how
// to behave + how to format output) plus the session's KIND file (what this
// session is). The base is picked by CHANNEL — a voice turn reads
// `voice-base.md`, written for the ear, instead of the text base — because
// output format is base material, and a voice turn must never be handed prose
// rules it then has to un-learn (the old shape appended a voice modifier AFTER
// the feature sections instead). One composer so callers cannot drift on the
// order: base first, kind second; per-turn steers and per-feature sections
// join after, at the caller.

import { loadSessionInstruction } from './load-session-instruction.js'

/** The session kinds with an identity file — the duty-book kinds' prompt-side
 *  twins (`workspace` → workspace-manager, `spawned` → spawned-session,
 *  `agent` → agent-colleague, `plain` → workspace-session; `voice` is the
 *  global kind on the voice base). `workspace-session` ships content-first,
 *  the duty-book precedent: no live door composes the plain kind yet. */
export type SessionInstructionKind =
  | 'global-root'
  | 'workspace-manager'
  | 'spawned-session'
  | 'agent-colleague'
  | 'workspace-session'

export function composeSessionInstruction(
  kind: SessionInstructionKind,
  options: { voice?: boolean; agentName?: string } = {},
): string {
  const base = loadSessionInstruction(options.voice === true ? 'voice-base' : 'base')
  let kindInstruction = loadSessionInstruction(kind)
  if (options.agentName !== undefined) {
    kindInstruction = kindInstruction.replaceAll('{{agentName}}', options.agentName)
  }
  // Fail-loud on an unfilled placeholder (the render-marker discipline): a
  // literal `{{agentName}}` reaching the model means the caller forgot the name.
  if (kindInstruction.includes('{{agentName}}')) {
    throw new Error(
      `Session instruction "${kind}" carries an {{agentName}} placeholder — pass options.agentName to compose it.`,
    )
  }
  return `${base}\n\n${kindInstruction}`
}