// Public surface of the `@vynel/memory` package.

export type {
  StructuralLogger,
  MemoryEntry,
  NewMemoryEntry,
  MemoryEntryKind,
  MemoryEntryCreatedSource,
  MemoryEntryCategory,
  MemoryEntryMention,
  NewMemoryEntryMention,
  MentionKind,
  MemorySearchResult,
  SearchMemoryEntriesInput,
} from './memory-types.js'

export {
  MEMORY_ENTRY_CREATED,
  MEMORY_ENTRY_UPDATED,
  MEMORY_ENTRY_ARCHIVED,
  MEMORY_ENTRY_HARD_DELETED,
} from './memory-events.js'

export type {
  MemoryEntryCreatedPayload,
  MemoryEntryUpdatedPayload,
  MemoryEntryArchivedPayload,
  MemoryEntryHardDeletedPayload,
} from './memory-events.js'

// Read ops
export {
  listMemoryEntriesForWorkspace,
  type ListMemoryEntriesInput,
  type ListMemoryEntriesResult,
  type ListMemoryEntriesCursor,
} from './queries/list-memory-entries-for-workspace.js'
export {
  loadWorkspaceContextForSession,
  type LoadWorkspaceContextForSessionInput,
  type WorkspaceContextSnapshot,
} from './session/load-workspace-context-for-session.js'
export {
  buildMemorySessionContribution,
  MEMORY_AGENT_INSTRUCTIONS,
} from './session/build-memory-session-contribution.js'

// Write ops
export { createMemoryEntry, type CreateMemoryEntryInput } from './lifecycle/create-memory-entry.js'
export { updateMemoryEntry, type UpdateMemoryEntryInput } from './lifecycle/update-memory-entry.js'
export { deleteMemoryEntry } from './lifecycle/delete-memory-entry.js'
export {
  recordMemoryEntryMention,
  type RecordMemoryEntryMentionInput,
} from './lifecycle/record-memory-entry-mention.js'

// Repo reads the HTTP layer calls directly for the workspace-ownership
// guard on single-entry routes (findEntryById) and the mentions list
// (listRecentMentionsForEntry) — no package.json subpath export exists
// for `./repositories`, so these are widened onto the main barrel
// instead of a new export map entry.
export { findEntryById, listRecentMentionsForEntry } from './repositories/index.js'

// Outbox consumers
export {
  cleanupMemoryForChatSessionHardDeleted,
  type CleanupMemoryForChatSessionHardDeletedInput,
  type CleanupMemoryForChatSessionHardDeletedResult,
} from './lifecycle/cleanup-memory-for-chat-session-hard-deleted.js'

// Workers + search-with-embedding (async at the boundary; model call
// outside the tx)
export {
  generateMemoryEmbeddings,
  type GenerateMemoryEmbeddingsResult,
} from './indexing/generate-memory-embeddings.js'
export {
  purgeSoftDeletedMemoryEntries,
  type PurgeSoftDeletedMemoryEntriesResult,
} from './lifecycle/purge-soft-deleted-memory-entries.js'
export { searchMemoryForAgent, type SearchMemoryForAgentInput } from './queries/search-memory-for-agent.js'
