// The shared pieces of a ROUTED (background) turn's provider input — the system
// steer + the MCP attachment both target runners (`delegateToWorkspaceRoot`,
// `delegateToSpawnedSession`) spread into `startChatSession`. One home so the
// two runners can never drift on how a routed turn is shaped.

// How a routed (background) turn should behave — appended to the SYSTEM prompt, never
// the task text (the task persists verbatim to the transcript). ACKNOWLEDGE-FIRST
// (persona-sessions, Chad's model-spoken call): the child speaks its own lifecycle —
// ack, milestones, one final report — through send_message; nothing is harvested.
export const ROUTED_TASK_INSTRUCTIONS =
  'This task was routed from the user’s assistant and runs in the background. You speak ' +
  'for yourself: FIRST, before starting the work, send a one-line acknowledgment with ' +
  'send_message to "requester" and kind "update" (e.g. "Received — starting on X, will ' +
  'report when done."). At meaningful milestones on longer work you may send further ' +
  'kind-"update" messages — brief status, never partial results dumps. When the work is ' +
  'DONE, send exactly ONE final send_message to "requester" with kind "report" carrying ' +
  'the REAL result — findings, numbers, paths, not just "done". Prefer read-only tools ' +
  '(Read, Glob, Grep, LS) for read/analysis tasks. An irreversible action (write, edit, ' +
  'delete, shell command) PAUSES until the user approves it from their app or chat — use ' +
  'one only when the task genuinely needs it, and if it is denied or times out, put what ' +
  'you found in your final report instead of retrying. If you hand part of the task ' +
  'onward (a spawned session, another workspace), never call the WHOLE task done: report ' +
  'what YOU completed and that the rest is still running — and when its result arrives ' +
  'later as a report, pass the REAL result up to your requester.'

// The REPORT-DELIVERY steer (session-comms, the revert flow) — the notify
// turn's variant of the routed-task steer: the inbound message is a child's
// FINAL result, not a new task. Absorb the real data; act only if genuinely
// needed; NEVER re-run the child's work. The cascade phrasing is conditional
// ("if something above you requested this") because the GLOBAL root's notify
// turn has NO REQUESTER — it sees send_message, but an upward send 400s
// honestly there; its reply IS the answer.
export const REPORT_DELIVERY_INSTRUCTIONS =
  'This message is a REPORT from a session, workspace, or agent you delegated work to — ' +
  'the FINAL result arriving back, relayed automatically by the system: that task is now ' +
  'complete. The user did NOT type or send it (its first line marks who it is from). ' +
  'Absorb it into your understanding. Act on it only if follow-up work is genuinely ' +
  'needed; NEVER re-run or re-verify the work it describes from scratch. If something ' +
  'above you requested this work, pass the REAL result up with send_message to ' +
  '"requester" — the full findings, numbers, paths, not just "done"; otherwise reply ' +
  'briefly with the outcome for the user. The user has already been notified on any ' +
  'channel they asked from — do not re-send this report to channels.'

// The UPDATE-DELIVERY steer (persona-sessions) — the interim sibling: a spoken
// ack/progress line from a child mid-task. Absorb quietly; the task is NOT
// done; never cascade routine status upward (only when something above is
// genuinely blocked on it).
export const UPDATE_DELIVERY_INSTRUCTIONS =
  'This message is an interim STATUS UPDATE from a session, workspace, or agent still ' +
  'working on something you delegated — relayed automatically by the system. The task is ' +
  'NOT finished; its real result will arrive later as a report. The user did NOT type or ' +
  'send it (its first line marks who it is from). Absorb it; if the user is actively ' +
  'waiting in this conversation, one short line of status is enough — otherwise reply ' +
  'with almost nothing. Do NOT treat the task as done, do NOT re-delegate or duplicate ' +
  'it, and do NOT pass routine status upward — only escalate if something above you is ' +
  'genuinely blocked on this information.'

// The DIRECT-DELIVERY steer (kind `direct_to_user`) — the notify FALLBACK only:
// the normal direct path persists the message with no turn at all; this steer
// runs when a workspace primary is the requester (no workspace absorb-net yet)
// or the root has no landed session row.
export const DIRECT_DELIVERY_INSTRUCTIONS =
  'This message is a FINAL answer a session, workspace, or agent addressed DIRECTLY TO THE ' +
  'USER (kind direct_to_user) — it is now displayed in this conversation as that sender ' +
  'speaking, and that task is complete. The user did NOT type it (its first line marks who ' +
  'it is from). The user has already read or will read it exactly as sent: do NOT restate, ' +
  'summarize, or narrate it — absorb it silently as context and reply with almost nothing ' +
  'unless it genuinely demands action from you.'

/** The COLLEAGUE identity block for an agent session's turn (persona-sessions):
 *  rides `systemPromptAppend` on EVERY turn — never seeded priming — so the
 *  persona survives swaps and transcript compaction. The agent's own prompt is
 *  the persona; this wrapper adds only the continuing-colleague framing. */
export function composeAgentColleaguePrompt(agentName: string, agentPrompt: string): string {
  return (
    `You are "${agentName}" — a persistent colleague with your own continuing session. ` +
    'This conversation is your memory: it accumulates across every task you are given, ' +
    'so build on what you already know instead of starting fresh.\n\n' +
    agentPrompt
  )
}

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
  /** The destructive tier — carded ONLY when the routed turn runs in ask mode. */
  askModeApprovalToolNames: string[]
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
  askModeApprovalToolNames?: string[]
} {
  if (mcpAttachment === undefined) return { deniedToolNames: [] }
  return {
    deniedToolNames: mcpAttachment.deniedMcpToolPatterns,
    mcpServers: mcpAttachment.mcpServers,
    allowedMcpToolPatterns: mcpAttachment.allowedMcpToolPatterns,
    ...(mcpAttachment.mutatingToolNames.length > 0
      ? { alwaysRequireApprovalToolNames: mcpAttachment.mutatingToolNames }
      : {}),
    ...(mcpAttachment.askModeApprovalToolNames.length > 0
      ? { askModeApprovalToolNames: mcpAttachment.askModeApprovalToolNames }
      : {}),
  }
}
