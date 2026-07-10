// Tag vocabulary + normalization — the ONE home for what a memory tag is.
//
// `context` is the reserved BEHAVIORAL tag: entries wearing it form the
// workspace's standing context, auto-injected at session start (the assistant
// keeps them current). Every other tag is topical organization. The defaults
// are STARTERS the picker suggests, not an enum — users coin their own freely
// (the "~100 categories" taxonomy grows in the wild, never hard-coded).

import { ValidationError } from '@vynel/errors'

export const CONTEXT_MEMORY_TAG = 'context'

export const DEFAULT_MEMORY_TAGS = [
  CONTEXT_MEMORY_TAG,
  'preference',
  'person',
  'project',
  'decision',
  'routine',
  'reminder',
  'note',
] as const

export const MAX_TAGS_PER_ENTRY = 8
export const MAX_TAG_LENGTH = 32

export function normalizeMemoryTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Normalize + dedupe + validate a user-supplied tag list. */
export function normalizeMemoryTags(raw: string[] | undefined): string[] {
  if (raw === undefined || raw.length === 0) return []
  const tags = [...new Set(raw.map(normalizeMemoryTag).filter((tag) => tag.length > 0))]
  if (tags.length > MAX_TAGS_PER_ENTRY) {
    throw new ValidationError(
      `A memory can carry at most ${MAX_TAGS_PER_ENTRY} tags — drop a few and try again.`,
    )
  }
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new ValidationError(
        `Tag "${tag.slice(0, 40)}" is too long — tags are short labels (max ${MAX_TAG_LENGTH} characters).`,
      )
    }
  }
  return tags
}
