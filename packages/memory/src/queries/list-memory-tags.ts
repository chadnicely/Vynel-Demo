// `listMemoryTags` — the tag-picker read: every tag in use across the live
// entries of ONE anchor (a workspace, or the user's global vault), fused with
// the DEFAULT_MEMORY_TAGS starters so a fresh vault still offers sensible
// choices. `context` (behavioral) leads; the rest sort alphabetically.

import type { Database } from '@vynel/db'
import {
  listDistinctMemoryTagsForUser,
  listDistinctMemoryTagsForWorkspace,
} from '../repositories/index.js'
import { CONTEXT_MEMORY_TAG, DEFAULT_MEMORY_TAGS } from '../memory-tags.js'

export function listMemoryTags(
  db: Database,
  input: { workspaceId: string } | { userId: string },
): string[] {
  const inUse =
    'workspaceId' in input
      ? listDistinctMemoryTagsForWorkspace(db, input.workspaceId)
      : listDistinctMemoryTagsForUser(db, input.userId)
  const merged = [...new Set([...DEFAULT_MEMORY_TAGS, ...inUse])].sort()
  return [CONTEXT_MEMORY_TAG, ...merged.filter((tag) => tag !== CONTEXT_MEMORY_TAG)]
}
