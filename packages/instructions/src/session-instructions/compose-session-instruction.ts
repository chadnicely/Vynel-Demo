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
  options: { voice?: boolean; agentName?: string; workspaceName?: string } = {},
): string {
  const base = loadSessionInstruction(options.voice === true ? 'voice-base' : 'base')
  let kindInstruction = loadSessionInstruction(kind)
  // Replacer FUNCTIONS, never replacement strings: the names are user input,
  // and `replaceAll(str, str)` reads `$&`, `$$`, `` $` `` in the replacement
  // (a workspace named "Acme $& Co" would re-insert the placeholder and trip
  // the guard below on every turn).
  const { agentName, workspaceName } = options
  if (agentName !== undefined) {
    kindInstruction = kindInstruction.replaceAll('{{agentName}}', () => agentName)
  }
  if (workspaceName !== undefined) {
    kindInstruction = kindInstruction.replaceAll('{{workspace_name}}', () => workspaceName)
  }
  // Fail loud on ANY unrendered placeholder — a kind file may add one (the
  // manager's {{workspace_name}}, the colleague's {{agentName}}) and a door
  // that forgets to pass the value must break in tests, never ship mustache
  // to the model.
  const unrendered = kindInstruction.match(/\{\{[^}]+\}\}/)
  if (unrendered !== null) {
    throw new Error(
      `Session instruction "${kind}" carries an unrendered ${unrendered[0]} placeholder — pass the matching option (agentName / workspaceName) to compose it.`,
    )
  }
  return `${base}\n\n${kindInstruction}`
}
