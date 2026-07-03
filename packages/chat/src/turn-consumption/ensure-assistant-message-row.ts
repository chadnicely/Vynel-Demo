// Per-turn helper for the SSE consumer (`consume-session-event-stream.ts`).
// Caches assistant message rows by their provider-supplied `messageId` (PK)
// so repeated text-chunk / thinking-chunk / tool-use events for the same
// message don't re-INSERT or re-SELECT.
//
// Extracted from `consume-session-event-stream.ts` at ship time per
// code-reviewer Gate 3 finding C4 (file-size cap). Coherent slice — same
// concept (assistant-row materialization), shared by 3 case branches
// (`text-chunk`, `thinking-chunk`, `tool-use-started`).
//
// Mixed PK source per D15: assistant rows use the provider's `messageId` as
// PK (lets the consumer group chunks by PK without restart-spanning in-
// memory state). User + tool-call rows use Vynel UUIDs.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { ChatMessage, ChatMessageSourceKind } from '../repositories/index.js'

// `sourceKind` is optional + additive (brain-tree P0.1): workspace chat omits it
// (the row stays null, rendered from `role` — byte-for-byte unchanged); the
// global-root persister passes 'global-root' so the transcript attributes the
// reply to the brain.
export function ensureAssistantMessageRow(
  db: Database,
  messageId: string,
  sessionId: string,
  cache: Map<string, ChatMessage>,
  sourceKind?: ChatMessageSourceKind,
): ChatMessage {
  const cached = cache.get(messageId)
  if (cached) return cached
  const existing = chatRepository.findChatMessageById(db, messageId)
  if (existing) {
    cache.set(messageId, existing)
    return existing
  }
  const now = new Date()
  const created = chatRepository.insertChatMessage(db, {
    id: messageId, // provider's messageId as PK per D15
    sessionId,
    role: 'assistant',
    body: '',
    sourceKind: sourceKind ?? null,
    sourceLabel: null,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
  })
  cache.set(messageId, created)
  return created
}
