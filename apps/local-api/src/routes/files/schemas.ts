// Zod schemas for the `files` HTTP routes — per `coding-standard.md`
// "Zod schemas": API-internal, suffix `Schema`, one consumer (apps/web
// is the first; promote to `@vynel/contracts/files` on the second).
// See `docs/blueprints/files/blueprint.md §7`.
//
// Containment is NOT validated here — the Zod schemas check the SHAPE
// of inputs (string, length, optional). Containment is re-validated
// by `resolveWorkspaceRelativePath` inside the core ops (defense in
// depth — the route never trusts the raw string).

import { z } from 'zod'

// Forward-slash, workspace-relative; bounded by the OS path-length cap
// + a generous in-app limit. The empty string is valid for /tree (root).
const RelativePathSchema = z.string().min(0).max(4096)
const NonEmptyRelativePathSchema = z.string().min(1).max(4096)

// Coerce 'true' / 'false' / 1 / 0 / undefined to boolean. Query-string
// values arrive as strings.
const QueryBooleanSchema = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.boolean()])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === true)

export const ListTreeQuerySchema = z.object({
  path: RelativePathSchema.optional(),
  includeHidden: QueryBooleanSchema,
})

export const ReadFileQuerySchema = z.object({
  path: NonEmptyRelativePathSchema,
})

export const StreamRawQuerySchema = z.object({
  path: NonEmptyRelativePathSchema,
})

export const WriteFileBodySchema = z.object({
  path: NonEmptyRelativePathSchema,
  // 1 MB editable cap per D12; the core op re-validates byte length
  // for UTF-8 + applies MAX_EDITABLE_BYTES.
  content: z.string().max(2 * 1024 * 1024),
})

export const CreateFileBodySchema = z.object({
  path: NonEmptyRelativePathSchema,
  content: z.string().max(2 * 1024 * 1024).optional(),
})

export const CreateDirectoryBodySchema = z.object({
  path: NonEmptyRelativePathSchema,
})

export const MoveBodySchema = z.object({
  fromPath: NonEmptyRelativePathSchema,
  toPath: NonEmptyRelativePathSchema,
  overwrite: z.boolean().optional(),
})

export const DeleteBodySchema = z.object({
  path: NonEmptyRelativePathSchema,
  recursive: z.boolean().optional(),
})

export const ListRecentActivityQuerySchema = z.object({
  cursorOccurredAt: z.string().datetime().optional(),
  cursorId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const ListFileHistoryQuerySchema = z.object({
  path: NonEmptyRelativePathSchema,
  cursorOccurredAt: z.string().datetime().optional(),
  cursorId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns. `serializers.ts` derives its
// return TYPES from these via `z.infer` (one source of truth per shape),
// and the routes wire them into `describeRoute` responses via `resolver`
// so the OpenAPI spec — and therefore the generated SDK return types —
// are real, not `unknown`. (Same pattern as `routes/knowledge`.) The
// `/raw` route streams bytes, not JSON — it has no response schema.

const EntryKindSchema = z.enum(['file', 'directory'])
const FileContentKindSchema = z.enum(['markdown', 'plain-text', 'image', 'pdf', 'unsupported'])
const FileActivityKindSchema = z.enum([
  'file-created',
  'file-edited',
  'file-moved',
  'file-deleted',
  'folder-created',
  'folder-deleted',
])
const FileActivityEditorSchema = z.enum(['self', 'external'])

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  kind: EntryKindSchema,
  relativePath: z.string(),
  fileSizeBytes: z.number().nullable(),
  modifiedAt: z.string(),
  childCount: z.number().nullable(),
})

export const FileContentSchema = z.object({
  relativePath: z.string(),
  kind: FileContentKindSchema,
  isText: z.boolean(),
  content: z.string().nullable(),
  fileSizeBytes: z.number(),
  modifiedAt: z.string(),
  isTruncated: z.boolean(),
})

export const FileMetadataSchema = z.object({
  relativePath: z.string(),
  fileSizeBytes: z.number(),
  modifiedAt: z.string(),
})

export const FileActivitySchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  activityKind: FileActivityKindSchema,
  editor: FileActivityEditorSchema,
  relativePath: z.string(),
  fromPath: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  occurredAt: z.string(),
})

const FileActivityCursorSchema = z.object({
  occurredAt: z.string(),
  id: z.string(),
})

// Envelope schemas — the exact top-level JSON each route emits.
export const ListTreeResponseSchema = z.object({
  entries: z.array(DirectoryEntrySchema),
})

export const CreateDirectoryResponseSchema = z.object({
  relativePath: z.string(),
  wasCreated: z.boolean(),
})

export const MoveResponseSchema = z.object({
  fromPath: z.string(),
  toPath: z.string(),
})

export const DeleteResponseSchema = z.object({
  relativePath: z.string(),
  kind: EntryKindSchema,
})

export const ListFileActivityResponseSchema = z.object({
  activities: z.array(FileActivitySchema),
  nextCursor: FileActivityCursorSchema.nullable(),
})

export { EntryKindSchema, FileContentKindSchema, FileActivityKindSchema, FileActivityEditorSchema }
