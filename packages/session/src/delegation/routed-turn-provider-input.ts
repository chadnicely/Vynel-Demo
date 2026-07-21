// The shared pieces of a ROUTED (background) turn's provider input — the system
// steer + the MCP attachment both target runners (`delegateToWorkspaceRoot`,
// `delegateToSpawnedSession`) spread into `startChatSession`. One home so the
// two runners can never drift on how a routed turn is shaped.

// How a routed (background) turn should behave — appended to the SYSTEM prompt, never
// the task text (the task persists verbatim to the transcript). Steers the model to
// read-only tools for read tasks and sets expectations for the approval pause.
export const ROUTED_TASK_INSTRUCTIONS =
  'This task was routed from the user’s assistant and runs in the background. Prefer ' +
  'read-only tools (Read, Glob, Grep, LS) for read/analysis tasks. An irreversible action ' +
  '(write, edit, delete, shell command) PAUSES until the user approves it from their app or ' +
  'chat — use one only when the task genuinely needs it, and if it is denied or times ' +
  'out, report your findings as text instead of retrying.'

/** The background workspace MCP attachment for a routed turn — structurally the
 *  api composer's output (`composeSessionMcpServers`), declared here so the
 *  session leaf never imports `@vynel/mcp` (invariant #2; the `FireScheduleDeps`
 *  precedent). WHY it exists: a routed turn RESUMES the same SDK session the
 *  interactive chat runs on, and a turn that attaches no MCP servers makes the
 *  SDK's deferred-tool reconciliation strip every `mcp__vynel*` tool and tell
 *  the model "MCP server disconnected" — a belief that persists into later
 *  interactive turns (the 2026-07-21 live bug). Background turns must attach
 *  the same background set schedule fires attach. */
export type RoutedTurnMcpAttachment = {
  mcpServers: Record<string, unknown>
  allowedMcpToolPatterns: string[]
  deniedMcpToolPatterns: string[]
  /** Feature mutating tools carded even under bypass (additive to the floor). */
  mutatingToolNames: string[]
  /** The MCP composer's per-feature prompt sections (tasks/notebook standing lines). */
  systemPromptAppend: string
}

/** Joins the routed-task instructions with the attachment's per-feature prompt
 *  sections — one home for both routed runners' system prompt. */
export function composeRoutedTurnSystemPrompt(
  mcpAttachment: RoutedTurnMcpAttachment | undefined,
): string {
  return mcpAttachment !== undefined && mcpAttachment.systemPromptAppend !== ''
    ? `${ROUTED_TASK_INSTRUCTIONS}\n\n${mcpAttachment.systemPromptAppend}`
    : ROUTED_TASK_INSTRUCTIONS
}

/** The attachment's provider-input fields, spread into `startChatSession` by
 *  both routed runners. No attachment → today's bare shape (empty denies). */
export function routedTurnMcpSessionFields(
  mcpAttachment: RoutedTurnMcpAttachment | undefined,
): {
  deniedToolNames: string[]
  mcpServers?: Record<string, unknown>
  allowedMcpToolPatterns?: string[]
  alwaysRequireApprovalToolNames?: string[]
} {
  if (mcpAttachment === undefined) return { deniedToolNames: [] }
  return {
    deniedToolNames: mcpAttachment.deniedMcpToolPatterns,
    mcpServers: mcpAttachment.mcpServers,
    allowedMcpToolPatterns: mcpAttachment.allowedMcpToolPatterns,
    ...(mcpAttachment.mutatingToolNames.length > 0
      ? { alwaysRequireApprovalToolNames: mcpAttachment.mutatingToolNames }
      : {}),
  }
}
