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

// The REPORT-DELIVERY steer (session-comms, the revert flow) — the notify
// turn's variant of the routed-task steer: the inbound message is a child's
// finished REPORT, not a new task. Absorb the real data; act only if genuinely
// needed; NEVER re-run the child's work. The cascade phrasing is conditional
// ("if the tool is available") because the GLOBAL root's notify turn has no
// requester and no report_to_requester tool — its reply IS the answer.
export const REPORT_DELIVERY_INSTRUCTIONS =
  'This message is a REPORT from a session or workspace you delegated work to — the real ' +
  'result arriving back, not a new task from the user. Absorb it into your understanding. ' +
  'Act on it only if follow-up work is genuinely needed; NEVER re-run or re-verify the ' +
  'work it describes from scratch. If something above you requested this work and the ' +
  'report_to_requester tool is available, pass the REAL result up with it (findings, ' +
  'numbers, paths — not just "done"); otherwise reply briefly with the outcome for the ' +
  'user. The user has already been notified on any channel they asked from — do not ' +
  're-send this report to channels.'

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

/** Joins the routed-turn instructions with the attachment's per-feature prompt
 *  sections — one home for both routed runners' system prompt. `instructions`
 *  defaults to the task steer; the report-delivery notify turn passes
 *  `REPORT_DELIVERY_INSTRUCTIONS` (same machinery, different steer). */
export function composeRoutedTurnSystemPrompt(
  mcpAttachment: RoutedTurnMcpAttachment | undefined,
  instructions: string = ROUTED_TASK_INSTRUCTIONS,
): string {
  return mcpAttachment !== undefined && mcpAttachment.systemPromptAppend !== ''
    ? `${instructions}\n\n${mcpAttachment.systemPromptAppend}`
    : instructions
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
