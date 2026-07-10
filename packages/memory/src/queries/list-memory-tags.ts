// `listMemoryTags` — the tag-picker read: every tag in use across the
// workspace's live entries, fused with the DEFAULT_MEMORY_TAGS starters so a
// fresh vault still offers sensible choices. `context` (behavioral) leads;
// the rest sort alphabetically.

import type { Database } from '@vynel/db'
import { listDistinctMemoryTagsForWorkspace } from '../repositories/index.js'
import { CONTEXT_MEMORY_TAG, DEFAULT_MEMORY_TAGS } from '../memory-tags.js'

export function listMemoryTags(db: Database, input: { workspaceId: string }): string[] {
  const inUse = listDistinctMemoryTagsForWorkspace(db, input.workspaceId)
  const merged = [...new Set([...DEFAULT_MEMORY_TAGS, ...inUse])].sort()
  return [CONTEXT_MEMORY_TAG, ...merged.filter((tag) => tag !== CONTEXT_MEMORY_TAG)]
}
