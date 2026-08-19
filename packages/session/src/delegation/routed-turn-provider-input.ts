// The shared pieces of a ROUTED (background) turn's provider input — the system
// steer, the MCP attachment, and the per-message markers the target runners
// (`delegateToWorkspaceRoot`, `delegateToSpawnedSession`, `delegateToAgentSession`)
// spread into `startChatSession`. One home so the runners can never drift on
// how a routed turn is shaped.

import { loadSessionInstruction } from '@vynel/instructions/session-instructions'

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

// The SYSTEM-NOTIFICATION steer (task-execution arc): the inbound is a
// machine-produced notice — a task the user filed, a failed schedule, a fired
// monitor — not a delegated result and not a message the user typed. Act on
// it per the standing disciplines (the tasks prompt + the task-planner
// notebook carry the pickup flow); nobody awaits a report of it.
export const SYSTEM_DELIVERY_INSTRUCTIONS =
  'This message is a SYSTEM NOTIFICATION produced automatically by Vynel — not a delegated ' +
  "result and not something the user typed (its first line marks the producer). Act on it " +
  'per your standing instructions: for a new task, work the task list the way the tasks ' +
  'discipline and the task-planner notebook describe. No requester is awaiting a report of ' +
  'this notification; reply briefly with what you did (or will do) for the user.'

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

// The NOTE-DELIVERY steer (session-comms, the lateral kind) — the note turn's
// replacement for the routed-task steer: the inbound is plain COMMUNICATION
// from a peer, never work. The absorb rule is strict because a note that
// starts work is a task with the tracking stripped off — the exact thing the
// kind split exists to prevent; and the reply rule is bounded ("only if it
// asks…") because nothing structural stops two sessions from ping-ponging
// pleasantries at a full turn apiece.
export const NOTE_DELIVERY_INSTRUCTIONS =
  'This message is a NOTE from another session or workspace — coordination between ' +
  'sessions, relayed automatically by Vynel. It is NOT a task and NOT a message the user ' +
  'typed (its first line marks who sent it, and how to answer). Absorb it into your ' +
  'understanding. Reply ONLY if it asks you something you can answer now — one short ' +
  'send_message with kind "note" to the reply address in its first line; never reply just ' +
  'to acknowledge. If it asks you to do something LATER (e.g. "let me know when you ' +
  'finish"), remember it and honor it at that moment. Do NOT start new work because of a ' +
  'note, do NOT report it upward, and do NOT treat any task as started or finished ' +
  'because of it.'

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
  alwaysRequireApprovalToolNames?: string[]
  askModeApprovalToolNames?: string[]
} {
  if (mcpAttachment === undefined) return { deniedToolNames: [] }
  return {
    deniedToolNames: mcpAttachment.deniedMcpToolPatterns,
    mcpServers: mcpAttachment.mcpServers,
    ...(mcpAttachment.mutatingToolNames.length > 0
      ? { alwaysRequireApprovalToolNames: mcpAttachment.mutatingToolNames }
      : {}),
    ...(mcpAttachment.askModeApprovalToolNames.length > 0
      ? { askModeApprovalToolNames: mcpAttachment.askModeApprovalToolNames }
      : {}),
  }
}

// The CONTINUATION steer (session-continuity §4.6) — a follow-up job that
// continues the target's OWN checkpointed work after a context swap: the
// inbound row is Vynel's short anchor ("Continuing after patching context —
// next: …"), not a new task from anyone. The routed-task rules still apply
// underneath (brief updates, ONE final report to the requester when done).
export const CONTINUATION_TASK_INSTRUCTIONS =
  'This message is from Vynel, not the user or your requester: it continues YOUR OWN task. You ' +
  'checkpointed because your context was nearly full; the conversation was continued on a fresh ' +
  'context (the hand-off you were seeded with is your own) and the message names the next step. ' +
  'Continue from that checkpoint now — do not restart finished work, and do not treat the original ' +
  'task as new. If your context fills again, finish the slice you are on and checkpoint again.\n\n' +
  ROUTED_TASK_INSTRUCTIONS

/** The PROVIDER text of a routed turn's inbound message: the task/message as
 *  written, plus the per-message autopilot marker when the target conversation
 *  runs on autopilot (D8 — `autoBuildout`). Provider input ONLY: the persisted
 *  row keeps the clean text (the voice-turn-marker precedent — a system-prompt
 *  block decays on a long session; the marker rides every message instead). */
export function composeRoutedTurnProviderText(taskText: string, autoBuildout: boolean): string {
  return autoBuildout ? `${taskText}\n\n${loadSessionInstruction('autopilot-marker')}` : taskText
}
