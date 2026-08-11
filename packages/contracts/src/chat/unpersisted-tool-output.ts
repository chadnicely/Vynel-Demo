// Tool outputs that must NOT be written to the transcript.
//
// The tool-call row stores `toolOutput` opaquely and never filters it — that is
// deliberate and right for almost everything, because the shape is
// tool-name-specific and the transcript is the user's honest record of what
// happened.
//
// `read_clipboard` breaks the assumption underneath it. Its output IS the
// clipboard's plaintext, and the clipboard is where a password manager, a
// banking app, or a 2FA prompt leaves things seconds earlier. Persisting it
// would put a credential in the user's database durably, and re-render it
// inline every time that conversation is reloaded — long after the moment it
// mattered. The tool's own instruction ("if it looks like a credential, stop")
// can only run AFTER the value has already been stored, so it is one step too
// late to prevent this.
//
// The value still reaches the model in the live turn — nothing about the task
// breaks. Only the durable copy is dropped.
//
// Lives in contracts because both sides need the same list: the desktop feature
// owns the tool, the chat feature owns the row, and they are sibling leaves
// that must not import each other.

/** Tool names whose output is replaced by a placeholder before it is stored. */
export const TOOL_NAMES_WITH_UNPERSISTED_OUTPUT: readonly string[] = [
  'mcp__desktop__read_clipboard',
]

/** What the transcript shows instead — the call is still recorded honestly, so
 *  the user can see the clipboard WAS read; only the contents are withheld. */
export const UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER =
  '[Clipboard contents were not saved to this conversation — they can contain passwords or ' +
  'one-time codes. Claude could read them at the time.]'

export function isUnpersistedToolOutput(toolName: string): boolean {
  return TOOL_NAMES_WITH_UNPERSISTED_OUTPUT.includes(toolName)
}

/** The value to persist for a tool call: the real output, or the placeholder
 *  when this tool's output must not outlive the turn. Pure. */
export function toolOutputForStorage(toolName: string, toolOutput: unknown): unknown {
  return isUnpersistedToolOutput(toolName) ? UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER : toolOutput
}
