// Domain-only types for the `memory` core layer.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer). Row types are re-exported
// from `@vynel/db` for consumer convenience.

export type { StructuralLogger } from '@vynel/logger'

export type {
  MemoryEntry,
  NewMemoryEntry,
  MemoryEntryKind,
  MemoryEntryCreatedSource,
  MemoryEntryCategory,
  MemoryEntryMention,
  NewMemoryEntryMention,
  MentionKind,
} from './repositories/index.js'

export type { MemorySearchResult, SearchMemoryEntriesInput } from './repositories/index.js'
