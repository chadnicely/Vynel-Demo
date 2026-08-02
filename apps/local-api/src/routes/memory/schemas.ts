// Zod request schemas for the `memory` HTTP surface. XxxSchema suffix;
// API-internal (single consumer = apps/web) lives here under the route
// folder per `coding-standard.md` "Zod schemas" — promote to
// `@vynel/contracts/memory/*` on the second consumer per the
// contracts-exports-map decision.

import { z } from 'zod'

const MemoryEntryKindSchema = z.enum([
  'person',
  'preference',
  'business-fact',
  'recurring-pattern',
  'note',
])

const MemoryEntryCategorySchema = z.enum(['user', 'preferences', 'memory'])

const MemoryEntryCreatedSourceSchema = z.enum([
  'workspace-seed',
  'user-manual',
  'onboarding-seed',
  'file-import',
])

// Open user vocabulary — length caps mirror @vynel/memory's normalizeMemoryTags
// (the core re-validates; this bounds the wire).
const MemoryTagsSchema = z.array(z.string().min(1).max(32)).max(8)

const MentionKindSchema = z.enum(['session-context-load', 'tool-output', 'agent-citation'])

export const ListMemoryEntriesQuerySchema = z.object({
  kind: MemoryEntryKindSchema.optional(),
  includeArchived: z.coerce.boolean().optional(),
  cursorLastMentionedAt: z.string().datetime().nullable().optional(),
  cursorId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const SearchMemoryQuerySchema = z.object({
  query: z.string().min(1).max(500),
  mode: z.enum(['fts', 'semantic', 'hybrid']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const CreateMemoryEntryBodySchema = z.object({
  kind: MemoryEntryKindSchema,
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(10_000),
  category: MemoryEntryCategorySchema,
  section: z.string().min(1).max(200),
  tags: MemoryTagsSchema.optional(),
})

export const UpdateMemoryEntryBodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(10_000).optional(),
  kind: MemoryEntryKindSchema.optional(),
  isArchived: z.boolean().optional(),
  // REPLACE semantics — the entry's tags become exactly this list.
  tags: MemoryTagsSchema.optional(),
})

export const ImportMemoryFileBodySchema = z.object({
  absolutePath: z.string().min(1).max(4096),
  tags: MemoryTagsSchema.optional(),
})

export const MemoryEntryParamSchema = z.object({
  entryId: z.string().min(1),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns. `serializers.ts` derives its
// return TYPES from these via `z.infer` (one source of truth per shape),
// and the routes wire them into `describeRoute` responses via `resolver`
// so the OpenAPI spec — and therefore the generated SDK return types —
// are real, not `never`.

export const MemoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Null for a USER-level (global) memory — it belongs to no workspace. */
  workspaceId: z.string().nullable(),
  kind: MemoryEntryKindSchema,
  title: z.string(),
  body: z.string(),
  category: MemoryEntryCategorySchema,
  section: z.string(),
  sourceMessageId: z.string().nullable(),
  createdSource: MemoryEntryCreatedSourceSchema,
  embeddingPresent: z.boolean(),
  embeddingModelVersion: z.string().nullable(),
  isArchived: z.boolean(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMentionedAt: z.string().nullable(),
})

export const MemoryEntryMentionSchema = z.object({
  id: z.string(),
  memoryEntryId: z.string(),
  sessionId: z.string(),
  messageId: z.string(),
  mentionKind: MentionKindSchema,
  mentionedAt: z.string(),
})

export const MemorySearchResultSchema = z.object({
  entryId: z.string(),
  matchedTitle: z.string(),
  matchedBody: z.string(),
  ftsScore: z.number().nullable(),
  semanticScore: z.number().nullable(),
  combinedScore: z.number(),
})

const ListMemoryEntriesCursorSchema = z.object({
  lastMentionedAt: z.string().nullable(),
  id: z.string(),
})

// Envelope schemas — the exact top-level JSON each route emits.
export const ListMemoryEntriesResponseSchema = z.object({
  entries: z.array(MemoryEntrySchema),
  nextCursor: ListMemoryEntriesCursorSchema.nullable(),
})

export const SearchMemoryResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
})

export const ListMemoryEntryMentionsResponseSchema = z.object({
  mentions: z.array(MemoryEntryMentionSchema),
})

export const ListMemoryTagsResponseSchema = z.object({
  tags: z.array(z.string()),
})
