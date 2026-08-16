// The turn streams' settings resolution — one home for the rule
// "explicit request input ?? the session's persisted setting". The surface's
// own default deliberately stays at the call site: each stream has different
// unattended semantics (the workspace/session streams default the mode to
// `ask`; the global core keeps its bypass default when nothing resolves).
//
// A null row value means "the user never set this on this session"
// (pre-existing rows, channel-born segments) and resolves to undefined, so a
// caller's `?? DEFAULT` fallback still applies.

import type { ChatSession } from '../repositories/index.js'
import type { ChatSessionSelectedMode } from '../schema/chat-sessions.js'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'

export type TurnSettingsInput = {
  model?: string | undefined
  mode?: ChatSessionSelectedMode | undefined
  thinkingEffort?: ThinkingEffortLevel | undefined
}

export type ResolvedTurnSettings = {
  model: string | undefined
  mode: ChatSessionSelectedMode | undefined
  thinkingEffort: ThinkingEffortLevel | undefined
}

export function resolveTurnSessionSettings(
  input: TurnSettingsInput,
  row: ChatSession | null,
): ResolvedTurnSettings {
  return {
    model: input.model ?? row?.selectedModel ?? undefined,
    mode: input.mode ?? row?.sessionMode ?? undefined,
    thinkingEffort: input.thinkingEffort ?? row?.thinkingEffort ?? undefined,
  }
}
