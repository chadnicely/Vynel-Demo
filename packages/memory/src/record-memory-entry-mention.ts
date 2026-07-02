// `recordMemoryEntryMention` — co-commits a mention row + the
// `lastMentionedAt` cache update on the memory_entries row, in a
// single transaction. Called by chat (session start, agent
// citation), skill executions, and `loadWorkspaceContextForSession`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertMention } from '@vynel/db/repositories/memory'
import { touchEntryMentionedAt } from '@vynel/db/repositories/memory'
import type { MentionKind } from '@vynel/db/repositories/memory'

export type RecordMemoryEntryMentionInput = {
  memoryEntryId: string
  sessionId: string
  messageId: string
  mentionKind: MentionKind
}

export function recordMemoryEntryMention(db: Database, input: RecordMemoryEntryMentionInput): void {
  const now = new Date()
  withTransaction(db, (tx) => {
    insertMention(tx, {
      id: randomUUID(),
      memoryEntryId: input.memoryEntryId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      mentionKind: input.mentionKind,
      mentionedAt: now,
    })
    touchEntryMentionedAt(tx, input.memoryEntryId, now)
  })
}
