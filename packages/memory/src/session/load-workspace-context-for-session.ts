// `loadWorkspaceContextForSession` — called by chat at session start
// (and skill executions that want the workspace's memory snapshot).
//
// SELECTIVE when the user (or the assistant) has tagged entries `context`:
// those entries ARE the workspace's standing context — they alone are
// injected, freshest first. With no context-tagged entries the snapshot
// falls back to the top-N-per-kind read, so memory keeps working before
// anyone learns about tags. Every returned entry gets a
// `session-context-load` mention so the recency signal advances.

import {
  listEntriesForKindBundle,
  listEntriesByTag,
  type MemoryEntry,
  type MemoryEntryKind,
} from '../repositories/index.js'
import { recordMemoryEntryMention } from '../lifecycle/record-memory-entry-mention.js'
import { CONTEXT_MEMORY_TAG } from '../memory-tags.js'
import type { Database } from '@vynel/db'

export type LoadWorkspaceContextForSessionInput = {
  workspaceId: string
  // Optional: when both are present, a `session-context-load` mention is
  // recorded per returned entry (provenance + recency). The session-build
  // composes the snapshot BEFORE the SDK assigns a session id, so it omits
  // them — the read still returns the snapshot, just without the mention.
  sessionId?: string
  messageId?: string
  topEntriesPerKind?: number
}

export type WorkspaceContextSnapshot = {
  topEntriesByKind: Record<MemoryEntryKind, MemoryEntry[]>
  loadedAt: Date
}

const DEFAULT_TOP_ENTRIES_PER_KIND = 10
// A generous ceiling on the context-tagged set — standing context should be
// curated, not unbounded; past this the oldest entries stop riding along.
const MAX_CONTEXT_TAGGED_ENTRIES = 50
const KINDS: MemoryEntryKind[] = [
  'person',
  'preference',
  'business-fact',
  'recurring-pattern',
  'note',
]

const EMPTY_BY_KIND = (): Record<MemoryEntryKind, MemoryEntry[]> => ({
  person: [],
  preference: [],
  'business-fact': [],
  'recurring-pattern': [],
  note: [],
})

export function loadWorkspaceContextForSession(
  db: Database,
  input: LoadWorkspaceContextForSessionInput,
): WorkspaceContextSnapshot {
  const contextTagged = listEntriesByTag(db, {
    workspaceId: input.workspaceId,
    tag: CONTEXT_MEMORY_TAG,
    limit: MAX_CONTEXT_TAGGED_ENTRIES,
  })

  let topEntriesByKind: Record<MemoryEntryKind, MemoryEntry[]>
  if (contextTagged.length > 0) {
    topEntriesByKind = EMPTY_BY_KIND()
    for (const entry of contextTagged) topEntriesByKind[entry.kind].push(entry)
  } else {
    const topN = input.topEntriesPerKind ?? DEFAULT_TOP_ENTRIES_PER_KIND
    topEntriesByKind = Object.fromEntries(
      KINDS.map((kind) => [kind, listEntriesForKindBundle(db, input.workspaceId, kind, topN)]),
    ) as Record<MemoryEntryKind, MemoryEntry[]>
  }

  // Each returned entry gets a session-context-load mention when a session +
  // message id are supplied (provenance + recency). Mentions are independently
  // transactional (one tx per entry); additive — a partial run leaves the
  // already-mentioned entries consistent. Omitted at session-build time (no
  // session id yet) — the snapshot still returns.
  if (input.sessionId !== undefined && input.messageId !== undefined) {
    const sessionId = input.sessionId
    const messageId = input.messageId
    for (const entries of Object.values(topEntriesByKind)) {
      for (const entry of entries) {
        recordMemoryEntryMention(db, {
          memoryEntryId: entry.id,
          sessionId,
          messageId,
          mentionKind: 'session-context-load',
        })
      }
    }
  }

  return { topEntriesByKind, loadedAt: new Date() }
}
