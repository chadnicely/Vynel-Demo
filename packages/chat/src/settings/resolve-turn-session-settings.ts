// THE SETTINGS RESOLUTION RULE — one home, one sentence:
//
//     input ?? row ?? DEFAULT
//
// "what this request explicitly asked for" beats "what the user last set on
// this session" beats "the surface's own default". The DEFAULT stays at the
// call site on purpose: the resolver is a pure two-way merge with no knowledge
// of the caller's vocabulary, and the mode's default is a single shared
// constant (`DEFAULT_SESSION_MODE` = `'auto'`, session-hardening D3 — every
// stream, every runner, the same value).
//
// A null row value means "the user never set this on this session"
// (pre-existing rows, channel/voice-born segments) and resolves to undefined,
// so the caller's `?? DEFAULT` still applies. That is also why a child born
// with its creator's settings (D4 — the birth stamp in
// `recordSpawnedSessionSegment`) resolves them for free: they are on its row,
// and a tool argument passed at turn time still wins over them.

import type { ChatSession } from '../repositories/index.js'
import type { ChatSessionSelectedMode } from '../schema/chat-sessions.js'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'

export type TurnSettingsInput = {
  model?: string | undefined
  mode?: ChatSessionSelectedMode | undefined
  thinkingEffort?: ThinkingEffortLevel | undefined
  /** Autopilot (session-hardening D8): the turn runs unattended — the runner
   *  appends the `autopilot-marker` instruction to the PROVIDER input so the
   *  model keeps going instead of stopping to ask. */
  autoBuildout?: boolean | undefined
}

export type ResolvedTurnSettings = {
  model: string | undefined
  mode: ChatSessionSelectedMode | undefined
  thinkingEffort: ThinkingEffortLevel | undefined
  autoBuildout: boolean | undefined
}

export function resolveTurnSessionSettings(
  input: TurnSettingsInput,
  row: ChatSession | null,
): ResolvedTurnSettings {
  return {
    model: input.model ?? row?.selectedModel ?? undefined,
    mode: input.mode ?? row?.sessionMode ?? undefined,
    thinkingEffort: input.thinkingEffort ?? row?.thinkingEffort ?? undefined,
    autoBuildout: input.autoBuildout ?? row?.autoBuildout ?? undefined,
  }
}
