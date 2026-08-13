// `buildClaudePreToolUseHook` — the can't-be-skipped half of Vynel's
// safety invariant: every irreversible tool call from a (sub)agent that
// would otherwise skip `canUseTool` (a `bypassPermissions` / `dontAsk`
// subagent mode) still produces a Vynel approval card. The mode × tool
// matrix itself lives in `tool-approval-policy.ts` (with the dated
// directives); this file owns only the hook mechanics.
//
// WHY a hook (not just `canUseTool`): a `PreToolUse` hook fires for EVERY
// tool call, unconditionally, regardless of the (sub)agent's permission
// mode — whereas `canUseTool` fires only SELECTIVELY for a subagent and
// can be skipped entirely under a bypass mode (SDK-matrix finding,
// 2026-06-21). So `canUseTool` is the primary card mechanism and this
// hook is the backstop that guarantees it runs.
//
// MECHANISM (Design A — confirmed by a live smoke 2026-06-21): for a tool
// the backstop covers we return `permissionDecision: 'ask'`, which routes
// the call INTO the existing `canUseTool` approval flow (the smoke showed a
// `bypassPermissions` subagent's `Write` + a PreToolUse `'ask'` triggered
// `canUseTool`, which then denied/carded it; a `'deny'` blocked it inline).
// For every other tool we return `{}` (no opinion) so the normal permission
// flow and the `canUseTool` gate are UNCHANGED. `canUseTool` stays the SOLE
// card mechanism; this hook only ensures it is reached.

import type { HookCallback } from '../base/claude-agent-sdk.js'
import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import { requiresApprovalCardBackstop } from './tool-approval-policy.js'

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

    // The floor + declared tiers, from the one policy home. Deliberately
    // NARROWER than the callback's own card matrix — the backstop rescues
    // declared tiers from skip-modes, it never widens what cards (see
    // `requiresApprovalCardBackstop`).
    const requiresApprovalCard = requiresApprovalCardBackstop(input.tool_name, permissionMode, {
      alwaysRequireApprovalToolNames,
      askModeApprovalToolNames,
    })

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
