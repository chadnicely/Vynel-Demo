// `buildClaudePostCompactHook` — captures the SDK's compaction summary
// (`PostCompactHookInput.compact_summary`) when a session auto-compacts and
// forwards it to an injected callback. Layer 1 of session continuity (ride
// auto-compaction; carry the summary into durable memory). Spec:
// `docs/agent-base/session-continuity.md` "Core operations".
//
// The hook is the PROVIDER end; it does NOT reach core directly (providers
// is a leaf — core depends on it, not the reverse). The `onCompaction`
// callback is the seam: the chat-session bridge injects one that routes to
// `captureCompactionSummary` (core). HOW the bridge connects (the closed
// `NormalizedSessionEvent` union vs an `AiAgentProvider` callback) is a
// flagged fork — see OVERNIGHT-STATUS. This factory + its capture contract
// are determinate regardless.
//
// Best-effort: a callback failure is logged, never thrown — a capture
// problem must never break the live session (the `run-claude-context-report`
// best-effort precedent).

import type { HookCallback } from '../base/claude-agent-sdk.js'

export type CompactionCapture = {
  sdkSessionId: string
  summary: string
}

export type OnCompactionCallback = (capture: CompactionCapture) => void | Promise<void>

export type BuildClaudePostCompactHookOptions = {
  logger?: { warn: (obj: Record<string, unknown>, message: string) => void }
}

export function buildClaudePostCompactHook(
  onCompaction: OnCompactionCallback,
  options: BuildClaudePostCompactHookOptions = {},
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PostCompact') {
      return {}
    }
    try {
      await onCompaction({ sdkSessionId: input.session_id, summary: input.compact_summary })
    } catch (error) {
      options.logger?.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId: input.session_id,
        },
        'failed to capture compaction summary',
      )
    }
    return {}
  }
}
