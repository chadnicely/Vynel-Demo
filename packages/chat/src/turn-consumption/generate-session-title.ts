// Heuristic title generator — first 80 chars of the user's first message,
// first line only. Per D11 — Phase 1 reliability over polish. Phase 1.5
// may add agent-generated titles behind a feature flag; at that point this
// function flips to async.
//
// Sync per the locked phase-1-sync-transactions decision (called inside
// consume-session-event-stream which is itself sync-shaped). Spec:
// `docs/blueprints/chat/blueprint.md §5.5`.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'

const MAX_TITLE_LENGTH = 80
const FALLBACK_TITLE = 'New session'

export function generateSessionTitle(db: Database, sessionId: string): string {
  const messages = chatRepository.listChatMessagesForSession(db, sessionId)
  const firstUserMessage = messages.find((m) => m.role === 'user')
  if (!firstUserMessage) return FALLBACK_TITLE
  const firstLine = firstUserMessage.body.trim().split('\n')[0] ?? ''
  const candidate = firstLine.slice(0, MAX_TITLE_LENGTH).trim()
  return candidate || FALLBACK_TITLE
}
