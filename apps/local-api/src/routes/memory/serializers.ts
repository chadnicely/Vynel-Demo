// Response serializers for `memory` routes. Convert DB rows (MemoryEntry,
// MemoryEntryMention, MemorySearchResult) to the JSON shape the SDK
// consumer sees, per the skills/channels `serializers.ts` precedent
// (chat inlines serialization instead; both shapes are acceptable per
// `structure-standard.md`).
//
// The `Serialized*` types are `z.infer<typeof XSchema>` — one source of
// truth (the Zod schema in `schemas.ts`), same precedent as knowledge's
// serializers. The schema also feeds `resolver()` in `index.ts` so the
// OpenAPI spec — and the generated SDK return types — are real.

import type { z } from 'zod'
import type { MemoryEntry, MemoryEntryMention, MemorySearchResult } from '@vynel/memory'
import { MemoryEntryMentionSchema, MemoryEntrySchema, MemorySearchResultSchema } from './schemas.js'

export type SerializedMemoryEntry = z.infer<typeof MemoryEntrySchema>

export function serializeEntry(entry: MemoryEntry, tags: string[] = []): SerializedMemoryEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    category: entry.category,
    section: entry.section,
    sourceMessageId: entry.sourceMessageId,
    createdSource: entry.createdSource,
    // Never expose the raw Buffer over HTTP — the embedding is an
    // internal artefact. Surface its presence as a boolean so the panel
    // can show "indexed for semantic search" status.
    embeddingPresent: entry.embedding !== null,
    embeddingModelVersion: entry.embeddingModelVersion,
    isArchived: entry.isArchived,
    tags,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    lastMentionedAt: entry.lastMentionedAt ? entry.lastMentionedAt.toISOString() : null,
  }
}

export type SerializedMemoryEntryMention = z.infer<typeof MemoryEntryMentionSchema>

export function serializeMention(mention: MemoryEntryMention): SerializedMemoryEntryMention {
  return {
    id: mention.id,
    memoryEntryId: mention.memoryEntryId,
    sessionId: mention.sessionId,
    messageId: mention.messageId,
    mentionKind: mention.mentionKind,
    mentionedAt: mention.mentionedAt.toISOString(),
  }
}

export type SerializedMemorySearchResult = z.infer<typeof MemorySearchResultSchema>

export function serializeSearchResult(result: MemorySearchResult): SerializedMemorySearchResult {
  // Search-result shape passes straight through — the FTS5 snippet already
  // carries literal `<mark>` tokens that the UI splits on (NEVER `v-html`
  // — chat Gate-3 XSS lock).
  return {
    entryId: result.entryId,
    matchedTitle: result.matchedTitle,
    matchedBody: result.matchedBody,
    ftsScore: result.ftsScore,
    semanticScore: result.semanticScore,
    combinedScore: result.combinedScore,
  }
}
