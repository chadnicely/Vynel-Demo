// Outbox event type constants + payload interfaces for the `memory`
// domain. Four lifecycle events — `memory.entry-created`,
// `memory.entry-updated`, `memory.entry-archived`,
// `memory.entry-hard-deleted`. No `memory.entry-mentioned` (high
// volume, no Phase 1 consumer).
//
// Each event row is co-committed in the same transaction as the
// state change via the `_shared/outbox` infra workspaces shipped.
//
// Consumers (Phase 1: none; Phase 1.5+: channels for notifications,
// knowledge-graph for the visual graph, sync for cross-device
// replication) cast the outbox row's payload to the typed shape
// below.

export const MEMORY_ENTRY_CREATED = 'memory.entry-created' as const
export const MEMORY_ENTRY_UPDATED = 'memory.entry-updated' as const
export const MEMORY_ENTRY_ARCHIVED = 'memory.entry-archived' as const
export const MEMORY_ENTRY_HARD_DELETED = 'memory.entry-hard-deleted' as const

export type MemoryEntryCreatedPayload = {
  entryId: string
  userId: string
  workspaceId: string
  kind: 'person' | 'preference' | 'business-fact' | 'recurring-pattern' | 'note'
  category: 'user' | 'preferences' | 'memory'
  section: string
  createdSource: 'workspace-seed' | 'user-manual' | 'onboarding-seed'
  createdAt: string
}

export type MemoryEntryUpdatedPayload = {
  entryId: string
  userId: string
  workspaceId: string
  updatedFields: string[]
  updatedAt: string
}

export type MemoryEntryArchivedPayload = {
  userId: string
  workspaceId: string
  category: 'user' | 'preferences' | 'memory'
  section: string
  count: number
  archivedAt: string
}

// MemoryEntryHardDeletedPayload has two shapes:
//
// 1. Per-entry / per-purge-tick from the cron worker — coarse signal.
//    `entryIds` is empty + `userId` / `workspaceId` are absent because
//    the purge sweep spans tenants in Phase 2 and the worker doesn't
//    SELECT-before-DELETE just to surface them. Consumers reconcile
//    via their own bookkeeping.
// 2. Per-entry from the (Phase 1.5+) admin force-delete flow — full
//    fields populated for direct one-row purges.
//
// Both fields stay optional so Phase 1 emits don't carry empty strings
// the type contract claims are populated. Consumers must check both
// arrays + the presence of user/workspace fields. (code-reviewer WARN
// 2026-05-25.)
export type MemoryEntryHardDeletedPayload = {
  entryIds: string[]
  userId?: string
  workspaceId?: string
  hardDeletedAt: string
}
