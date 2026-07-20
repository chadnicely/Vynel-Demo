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
  /** Per-turn feature mutating tools, UNIONED with the static floor — a tool in
   *  either set cards even under bypass. ADDITIVE; the floor is never removed. */
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

    // Behavior gate: under bypass mode, a tool in NEITHER the static floor nor
    // the per-turn feature mutating set runs without an approval card.
    //
    // `auto` is deliberately NOT here: in auto, Anthropic's classifier is the
    // sole gate (no hardcoded Vynel floor — the user's directive). The classifier
    // approves safe tools (they never reach this callback) and escalates only its
    // UNCERTAIN cases to `canUseTool`, which then card — exactly like `ask`.
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
