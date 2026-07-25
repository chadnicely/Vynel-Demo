// `buildClaudePreToolUseHook` — the can't-be-skipped half of Vynel's
// safety invariant: every irreversible tool call from a (sub)agent that
// would otherwise skip `canUseTool` (a `bypassPermissions` / `dontAsk`
// mode) still produces a Vynel approval card.
//
// In `auto`, the MAIN session defers to Anthropic's safety classifier (the
// user's directive — NO hardcoded Vynel floor pre-empting it). A SUBAGENT,
// however, keeps its OWN permission mode — the SDK does NOT clamp it to the
// parent's `auto` (proven by the 2026-06-21 live smoke: a `bypassPermissions`
// subagent's `Write` skipped `canUseTool` and was caught ONLY here). So this
// backstop stands down ONLY for the auto MAIN session (no `agent_id`); for any
// subagent call (`agent_id` present) it still forces the floor, even under an
// auto root.
//
// WHY a hook (not just `canUseTool`): a `PreToolUse` hook fires for EVERY
// tool call, unconditionally, regardless of the (sub)agent's permission
// mode — whereas `canUseTool` fires only SELECTIVELY for a subagent and
// can be skipped entirely under a bypass mode (SDK-matrix finding,
// 2026-06-21). So `canUseTool` is the primary card mechanism and this
// hook is the backstop that guarantees it runs.
//
// MECHANISM (Design A — confirmed by a live smoke 2026-06-21): for a
// tool in `TOOLS_ALWAYS_REQUIRING_APPROVAL` we return
// `permissionDecision: 'ask'`, which routes the call INTO the existing
// `canUseTool` approval flow (the smoke showed a `bypassPermissions`
// subagent's `Write` + a PreToolUse `'ask'` triggered `canUseTool`,
// which then denied/carded it; a `'deny'` blocked it inline). For every
// other tool we return `{}` (no opinion) so the normal permission flow
// and the `canUseTool` behavior gate are UNCHANGED — zero regression to
// the shipped main-session path. `canUseTool` stays the SOLE card
// mechanism; this hook only ensures it is reached.
//
// The policy is the static floor (`tools-always-requiring-approval.ts`) UNIONED
// with the per-turn `alwaysRequireApprovalToolNames` (a feature's declared mutating tools,
// e.g. desktop `act_on_app`). The floor is imported here directly — ADDITIVE, so
// the backstop cards the floor even when no per-turn set is passed — and the
// SAME effective check is used by `buildClaudeCanUseToolCallback`, so gate and
// backstop can't drift.

import type { HookCallback } from '../base/claude-agent-sdk.js'
import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import { TOOLS_ALWAYS_REQUIRING_APPROVAL } from './tools-always-requiring-approval.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function buildClaudePreToolUseHook(
  permissionMode: ClaudePermissionMode,
  alwaysRequireApprovalToolNames?: ReadonlySet<string>,
  askModeApprovalToolNames?: ReadonlySet<string>,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {}
    }
    // Force subagents SYNCHRONOUS. Since SDK 0.3.2xx the Agent tool launches
    // in the BACKGROUND by default — but Vynel's one-shot turn model tears the
    // query down when the main turn ends, silently killing a background agent
    // mid-run (and its activity could never be traced to a finished turn).
    // Synchronous keeps the agent's whole run inside the turn, where its
    // marked events render live under the Agent card. Every mode, main or sub
    // — spawn policy, independent of the approval policy below, and COMPOSED
    // with it (a decision must never be shadowed by the rewrite).
    const forcedSyncInput =
      (input.tool_name === 'Agent' || input.tool_name === 'Task') &&
      isRecord(input.tool_input) &&
      input.tool_input['run_in_background'] !== false
        ? { ...input.tool_input, run_in_background: false }
        : undefined

    // The auto MAIN session defers entirely to Anthropic's classifier — the
    // hardcoded floor must not pre-empt it (the user's directive). A SUBAGENT
    // (`agent_id` present) keeps its own mode — the SDK does NOT clamp it to the
    // parent's `auto` — so the floor still backstops it here, even under auto.
    const floorStandsDown = permissionMode === 'auto' && input.agent_id === undefined
    // The destructive tier cards in ASK mode only. The `'ask'` decision is what
    // pulls the call OUT of the MCP wildcard's `allowedTools` pre-approval and
    // into `canUseTool` (live smoke 2026-07-26 — bare allowedTools entries
    // otherwise shadow the callback entirely). Auto/bypass run these uncarded.
    // `plan-only` is included DEFENSIVELY: nothing routes it today, but the MCP
    // wildcard still rides its allowedTools, and whether SDK plan mode honors
    // that pre-approval for MCP tools is unsmoked — a card there is strictly
    // safer than an uncarded delete from a mode documented as non-executing.
    const destructiveTierApplies = permissionMode === 'ask' || permissionMode === 'plan-only'
    const requiresApprovalCard =
      (!floorStandsDown &&
        (TOOLS_ALWAYS_REQUIRING_APPROVAL.has(input.tool_name) ||
          (alwaysRequireApprovalToolNames?.has(input.tool_name) ?? false))) ||
      (destructiveTierApplies && (askModeApprovalToolNames?.has(input.tool_name) ?? false))

    if (forcedSyncInput === undefined && !requiresApprovalCard) {
      // No opinion — let the normal permission flow + canUseTool gate decide.
      return {}
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...(requiresApprovalCard
          ? {
              // Force the call into Vynel's canUseTool approval card even when
              // the (sub)agent's permission mode would otherwise skip it.
              permissionDecision: 'ask' as const,
              permissionDecisionReason:
                'Vynel requires an approval card for this tool, even for agents configured to skip permission prompts.',
            }
          : {}),
        ...(forcedSyncInput !== undefined ? { updatedInput: forcedSyncInput } : {}),
      },
    }
  }
}
