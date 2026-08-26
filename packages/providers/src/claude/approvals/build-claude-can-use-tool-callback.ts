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
import {
  readPermissionMode,
  type PermissionModeSource,
} from '../../shared/start-chat-session-input.js'
import type { SyntheticEventQueue } from '../session/synthetic-event-queue.js'
import { decideCanUseTool } from './tool-approval-policy.js'

export type BuildClaudeCanUseToolCallbackInput = {
  pendingApprovalRegistry: PendingApprovalRegistry
  /** Read at CALL time, never captured — the mode can change mid-turn. */
  permissionMode: PermissionModeSource
  /** Read at call time — the SDK assigns the session id only on its first
   *  event, which may arrive after the first tool use (blueprint §19). */
  sessionIdHolder: { current: string | null }
  syntheticEventQueue: SyntheticEventQueue<NormalizedSessionEvent>
  /** Per-turn feature mutating tools, UNIONED with the static floor — a tool
   *  in either set cards in every carding mode. The user's `bypass` and
   *  `auto` never consult these here. */
  alwaysRequireApprovalToolNames?: ReadonlySet<string>
  /** The ask-mode destructive tier. Now consulted HERE too: with no MCP
   *  wildcards left in `allowedTools`, every MCP call reaches this callback,
   *  and the map — not an upstream pre-approval — decides which of them card
   *  in ask mode. See `tool-approval-policy.ts`. */
  askModeApprovalToolNames?: ReadonlySet<string>
  /** The turn's composed in-process server names — scopes the ask-mode
   *  map-allow to Vynel's own servers; an external (settings-loaded) server's
   *  tools keep carding in ask, as they did before the re-plumb. */
  composedMcpServerNames?: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function buildClaudeCanUseToolCallback(
  input: BuildClaudeCanUseToolCallbackInput,
): CanUseTool {
  return async (toolName, toolInput, callOptions) => {
    const sessionId = input.sessionIdHolder.current ?? 'pending-session'

    // The whole mode × tool matrix lives in `tool-approval-policy.ts` (the
    // dated directives ride there). 'allow' resolves immediately — including
    // every MCP tool outside the declared card tiers, the map-check that
    // replaced the `mcp__<server>__*` wildcard pre-approval.
    if (
      decideCanUseTool(toolName, readPermissionMode(input.permissionMode), {
        alwaysRequireApprovalToolNames: input.alwaysRequireApprovalToolNames,
        askModeApprovalToolNames: input.askModeApprovalToolNames,
        composedMcpServerNames: input.composedMcpServerNames,
      }) === 'allow'
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
