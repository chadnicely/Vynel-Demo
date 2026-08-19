// Write-through at session resolve: the settings an interactive turn carried
// become the session row's persisted truth — a fresh conversation's first turn
// stamps the row it just created; a resumed turn re-affirms, so the row always
// matches what the user's composer showed at send time. Writes only what the
// REQUEST carried, never resolved fallbacks — an omitted field stays "never
// set" (null), so channel/voice turns that omit everything write nothing.
//
// Best-effort by contract: a preferences write must never fail the user's
// turn — the failure is logged and the turn continues.

import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../chat-types.js'
import { updateChatSessionSettings } from './update-chat-session-settings.js'
import type { TurnSettingsInput } from './resolve-turn-session-settings.js'

export function persistTurnSessionSettings(
  db: Database,
  sessionId: string,
  input: TurnSettingsInput,
  options: { logger?: StructuralLogger } = {},
): void {
  const patch = {
    ...(input.mode !== undefined ? { sessionMode: input.mode } : {}),
    ...(input.model !== undefined ? { selectedModel: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
    ...(input.autoBuildout !== undefined ? { autoBuildout: input.autoBuildout } : {}),
  }
  if (Object.keys(patch).length === 0) return
  try {
    updateChatSessionSettings(db, sessionId, patch)
  } catch (error) {
    options.logger?.warn(
      { error: String(error), sessionId },
      'turn settings write-through failed — the turn continues on the requested values',
    )
  }
}
