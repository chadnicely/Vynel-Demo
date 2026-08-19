// Core op — update a chat session's composer settings (mode / model /
// thinking effort / auto-buildout). Two callers: the settings route (a chip
// change persists immediately, no send needed) and the interactive turn
// streams' write-through (what the user's composer showed at send time
// becomes the row's truth). Partial by design — only provided fields change;
// an empty patch is a no-op read.
//
// No outbox event — composer settings are user-only preferences, not state
// downstream consumers track (the rename precedent).
//
// THE VOICE EXCEPTION (session-hardening D2): a `voice`-scope row is refused.
// The spoken thread runs the VOICE TIER on every leg — the server forces
// sonnet/low/auto regardless of what a caller sends — so a persisted setting
// there could only ever be a lie the UI shows and no turn honours. Refusing
// loudly (403) beats accepting a write nothing reads.

import * as chatRepository from '../repositories/index.js'
import { ForbiddenError, NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { ChatSession } from '../repositories/index.js'
import type { ChatSessionSelectedMode } from '../schema/chat-sessions.js'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'

export type ChatSessionSettingsPatch = {
  sessionMode?: ChatSessionSelectedMode | undefined
  selectedModel?: string | undefined
  thinkingEffort?: ThinkingEffortLevel | undefined
  autoBuildout?: boolean | undefined
}

export function updateChatSessionSettings(
  db: Database,
  sessionId: string,
  patch: ChatSessionSettingsPatch,
): ChatSession {
  const fields = {
    ...(patch.sessionMode !== undefined ? { sessionMode: patch.sessionMode } : {}),
    ...(patch.selectedModel !== undefined ? { selectedModel: patch.selectedModel } : {}),
    ...(patch.thinkingEffort !== undefined ? { thinkingEffort: patch.thinkingEffort } : {}),
    ...(patch.autoBuildout !== undefined ? { autoBuildout: patch.autoBuildout } : {}),
  }
  const existing = chatRepository.findChatSessionById(db, sessionId)
  if (!existing) throw new NotFoundError('chat-session', sessionId)
  if (existing.scope === 'voice') {
    throw new ForbiddenError(
      'The voice thread always runs hands-free on the voice tier — its settings cannot be changed.',
    )
  }
  if (Object.keys(fields).length === 0) return existing
  const updated = chatRepository.updateChatSession(db, sessionId, fields)
  if (!updated) throw new NotFoundError('chat-session', sessionId)
  return updated
}
