// Response serializer for `journal` HTTP routes. Date columns emit as ISO
// strings (`entryDate` is already a text day). No secret field to strip — the
// whole row is owner-visible. Single source of truth for the response shape
// is `@vynel/contracts/journal/journal-http` (the tasks precedent).

import type { JournalEntry } from '@vynel/journal'
import type { JournalEntryResponse } from '@vynel/contracts/journal/journal-http'

export function serializeJournalEntryForResponse(entry: JournalEntry): JournalEntryResponse {
  return {
    id: entry.id,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    entryDate: entry.entryDate,
    content: entry.content,
    source: entry.source,
    sessionId: entry.sessionId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}
