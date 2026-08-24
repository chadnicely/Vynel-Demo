// Response serializer for `journal` HTTP routes. Date columns emit as ISO
// strings (`entryDate` is already a text day). No secret field to strip — the
// whole row is owner-visible. Single source of truth for the response shape
// is `@vynel/contracts/journal/journal-http` (the tasks precedent).

import type { Database } from '@vynel/db'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { JournalEntry } from '@vynel/journal'
import type { JournalEntryResponse } from '@vynel/contracts/journal/journal-http'

export function serializeJournalEntryForResponse(
  entry: JournalEntry,
  sessionTitle: string | null = null,
): JournalEntryResponse {
  return {
    id: entry.id,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    entryDate: entry.entryDate,
    content: entry.content,
    source: entry.source,
    sessionId: entry.sessionId,
    sessionTitle,
    commitRef: entry.commitRef,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

/** The pointer chip's label — the writing session's title, resolved at read
 *  time (loose ref: the session may be gone, and a foreign id must never leak
 *  a title; both resolve to null and the chip simply doesn't render). */
export function resolveJournalSessionTitle(
  db: Database,
  userId: string,
  sessionId: string | null,
): string | null {
  if (sessionId === null) return null
  const session = findChatSessionById(db, sessionId)
  if (session === null || session.userId !== userId) return null
  return session.title ?? null
}