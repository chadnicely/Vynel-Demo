// `buildClaudePostToolUseHook` — the MID-TURN context channel. After every
// tool result on the MAIN thread the hook asks an injected callback whether it
// has something to say to the model right now, and delivers the line as the
// SDK's `additionalContext` (PostToolUse hook output — the runtime feeds it to
// the model beside the tool result). What is said lives OUTSIDE the provider:
// the callback receives the session's live context occupancy (the same numbers
// the chat consumer persists per assistant message) and returns text or null.
// The one caller today is session-continuity's context nudge ("you've crossed
// the swap threshold — finish the slice, then checkpoint"); a long agentic turn
// has no next user message to ride, so this is the only way to reach it.
//
// SUBAGENT tool calls are skipped (`agent_id` present): a subagent has its own
// context window and cannot checkpoint the conversation it works inside.
//
// Best-effort: a callback failure is logged, never thrown — a nudge problem
// must never break the live tool loop (the PostCompact hook precedent).

import type { HookCallback } from '../base/claude-agent-sdk.js'

/** The session's live context state, as the provider knows it mid-turn: the
 *  LAST assistant request's input side (input + cache read + cache creation)
 *  and the model that ran it. Null before the first assistant message. */
export type LiveContextState = {
  usedTokens: number
  model: string | null
}

export type ToolResultContextCallback = (state: LiveContextState) => string | null

/** The mutable holder the session runner updates as usage messages stream past —
 *  the hook reads whatever is current when a tool result lands. */
export type LiveContextHolder = { current: LiveContextState | null }

export type BuildClaudePostToolUseHookOptions = {
  logger?: { warn: (obj: Record<string, unknown>, message: string) => void }
}

export function buildClaudePostToolUseHook(
  onToolResultContext: ToolResultContextCallback,
  liveContext: LiveContextHolder,
  options: BuildClaudePostToolUseHookOptions = {},
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    // A subagent's tools: its own window, not the conversation's — skip.
    if (input.agent_id !== undefined) return {}
    if (liveContext.current === null) return {}
    try {
      const context = onToolResultContext(liveContext.current)
      if (context === null || context.trim() === '') return {}
      return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }
    } catch (error) {
      options.logger?.warn(
        { error: error instanceof Error ? error.message : String(error), sessionId: input.session_id },
        'failed to compose tool-result context',
      )
      return {}
    }
  }
}
