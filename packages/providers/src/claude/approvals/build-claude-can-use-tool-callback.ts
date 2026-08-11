// `buildClaudeCanUseToolCallback` — bridges the SDK's `canUseTool` permission
// hook to Vynel's approval flow. The returned callback applies the behavior
// gate, registers a pending approval, awaits the user's decision (the Promise
// the SDK awaits — the paused agent), then translates the decision to the
// SDK's `PermissionResult` shape. The wait is resolved from outside the
// callback via `respondToApprovalRequest` -> `PendingApprovalRegistry.resolve`.
// See `docs/blueprints/providers/blueprint.md §11.4` + `§10`.

import { randomUUID } from 'node:crypto'
import type { CanUseTool } from '../base/claude-agent-sdk.js'
import type { ApprovalDecision } from '../../shared/approval-decision.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'
import type { PendingApprovalRegistry } from '../../shared/pending-approval-registry.js'
import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import type { SyntheticEventQueue } from '../session/synthetic-event-queue.js'
import { TOOLS_ALWAYS_REQUIRING_APPROVAL } from './tools-always-requiring-approval.js'

export type BuildClaudeCanUseToolCallbackInput = {
  pendingApprovalRegistry: PendingApprovalRegistry
  permissionMode: ClaudePermissionMode
  /** Read at call time — the SDK assigns the session id only on its first
   *  event, which may arrive after the first tool use (blueprint §19). */
  sessionIdHolder: { current: string | null }
  syntheticEventQueue: SyntheticEventQueue<NormalizedSessionEvent>
  /** Per-turn feature mutating tools, UNIONED with the static floor — a tool
   *  in either set cards under `bypass-with-behavior-gate` (the unattended
   *  default). The user's `bypass` and `auto` never consult these here. */
  alwaysRequireApprovalToolNames?: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function buildClaudeCanUseToolCallback(
  input: BuildClaudeCanUseToolCallbackInput,
): CanUseTool {
  return async (toolName, toolInput, callOptions) => {
    const sessionId = input.sessionIdHolder.current ?? 'pending-session'

    // The user's bypass means bypass, and AUTO MEANS NO APPROVAL — neither
    // raises a card for any tool.
    //
    // Auto previously stopped short of this: the classifier's UNCERTAIN cases
    // escalated to `canUseTool` and carded here "exactly like ask" (Chad's
    // 2026-07-30 directive). Kafi overruled that 2026-08-11 after a live smoke
    // where it hung a turn: a desktop tool parked on an escalated approval the
    // user was never expecting — in a mode whose whole promise is "don't ask
    // me" — with no card on screen to answer. The rule is now flat: ask asks,
    // auto and bypass do not.
    //
    // CONSEQUENCE, deliberately accepted: at this layer auto is now equivalent
    // to bypass. The classifier still shapes what the SDK runs, but it can no
    // longer stop a call by escalating — auto is the user's standing consent,
    // the same reading that already lets `request_desktop_access` grant
    // uncarded there.
    if (input.permissionMode === 'bypass' || input.permissionMode === 'auto') {
      return { behavior: 'allow', updatedInput: toolInput }
    }

    // Behavior gate for the UNATTENDED default: a tool in NEITHER the static
    // floor nor the per-turn feature mutating set runs without a card; floor
    // tools card and park for the user (surface-up approval).
    if (
      input.permissionMode === 'bypass-with-behavior-gate' &&
      !TOOLS_ALWAYS_REQUIRING_APPROVAL.has(toolName) &&
      !(input.alwaysRequireApprovalToolNames?.has(toolName) ?? false)
    ) {
      return { behavior: 'allow', updatedInput: toolInput }
    }

    // Register the pending approval and emit `approval-requested`. The agent
    // is paused on this Promise until the user (or a session teardown)
    // resolves it through `PendingApprovalRegistry.resolve`.
    const approvalRequestId = randomUUID()
    const requestedAt = new Date()
    const decision = await new Promise<ApprovalDecision>((resolve) => {
      input.pendingApprovalRegistry.register({
        approvalRequestId,
        sessionId,
        toolName,
        toolInput,
        requestedAt,
        resolve,
      })
      input.syntheticEventQueue.enqueue({
        kind: 'approval-requested',
        sessionId,
        approvalRequestId,
        parentMessageId: '', // the runner threads the real id once the SDK message arrives
        toolName,
        toolInput,
        requestedAt,
        // The SDK's per-call tool_use id — the consumer's correlation onto the
        // chat_tool_calls row (audit toolUseId + the 'denied' settle).
        toolUseId: callOptions.toolUseID,
      })
    })

    // Emit `approval-resolved` for symmetry — consumers update the card UI.
    input.syntheticEventQueue.enqueue({
      kind: 'approval-resolved',
      sessionId,
      approvalRequestId,
      decision,
      resolvedAt: new Date(),
      toolUseId: callOptions.toolUseID,
    })

    switch (decision.kind) {
      case 'approved':
        return {
          behavior: 'allow',
          updatedInput: isRecord(decision.updatedInput) ? decision.updatedInput : toolInput,
        }
      case 'denied':
        return { behavior: 'deny', message: decision.reason }
      case 'timed-out':
        return { behavior: 'deny', message: 'Approval request timed out.' }
      case 'cancelled':
        return { behavior: 'deny', message: 'Approval request cancelled.' }
    }
  }
}
