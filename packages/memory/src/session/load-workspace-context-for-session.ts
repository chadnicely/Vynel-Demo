// `loadWorkspaceContextForSession` — called by chat at session start
// (and skill executions that want the workspace's memory snapshot).
// Returns the top-N entries per kind for the agent's context block
// + records a `session-context-load` mention on every returned
// entry so the recency signal advances.

import {
  listEntriesForKindBundle,
  type MemoryEntry,
  type MemoryEntryKind,
} from '../repositories/index.js'
import { recordMemoryEntryMention } from '../lifecycle/record-memory-entry-mention.js'
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
const KINDS: MemoryEntryKind[] = [
  'person',
  'preference',
  'business-fact',
  'recurring-pattern',
  'note',
]

export function loadWorkspaceContextForSession(
  db: Database,
  input: LoadWorkspaceContextForSessionInput,
): WorkspaceContextSnapshot {
  const topN = input.topEntriesPerKind ?? DEFAULT_TOP_ENTRIES_PER_KIND
  const topEntriesByKind = Object.fromEntries(
    KINDS.map((kind) => [kind, listEntriesForKindBundle(db, input.workspaceId, kind, topN)]),
  ) as Record<MemoryEntryKind, MemoryEntry[]>

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
