// Zod request schemas for chat routes. Per `coding-standard.md` "Zod schemas"
// — XxxSchema suffix; API-internal (single consumer) lives here under the
// route folder. Not promoted to `@vynel/contracts/chat/*` in Phase 1
// (apps/web is the first consumer; promote on the second per the
// contracts-exports-map decision).
//
// Per blueprint §7.1.

import { z } from 'zod'
import { CHAT_MODEL_IDS } from '@vynel/contracts/chat/chat-models'
import { SESSION_MODES, type SessionMode } from '@vynel/session'

// ~5 MB once base64 is decoded (base64 inflates ~4/3). Per-image, generous for
// pasted screenshots while bounding a single JSON turn POST.
const MAX_IMAGE_BASE64_LENGTH = 7_000_000
const MAX_ATTACHED_IMAGES = 6

// Derived from @vynel/session's canonical SESSION_MODES so the route enum can't
// drift from the SessionMode union — a renamed/removed mode fails to compile here.
const SESSION_MODE_VALUES = SESSION_MODES.map((entry) => entry.mode) as [SessionMode, ...SessionMode[]]

export const AttachedImageInputSchema = z.object({
  // Path-traversal defense at the HTTP boundary — the filename is written to
  // (and later read from) the session images dir. The core layer's
  // `attached-images.ts` re-checks the same patterns (defense in depth, Gate 3
  // finding C2). Display-only otherwise.
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) =>
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.includes('\0') &&
        name !== '.' &&
        name !== '..' &&
        !name.split(/[/\\]/).some((segment) => segment === '..'),
      'Filename must not contain path separators, "..", or null bytes.',
    ),
  // Restricted to what the provider's handle-attached-images supports — any
  // other type would be written as `.bin` and not read as an image.
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  /** The image bytes, base64-encoded. */
  base64Data: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
})

export const StartChatTurnRequestSchema = z.object({
  /** Omit to start a new session; provide to resume an existing one. */
  resumeSessionId: z.string().optional(),
  /**
   * Run this turn on the workspace's continuing PRIMARY conversation
   * (primary-as-thread; the wire flag keeps the source name `continueRoot`).
   * The server resolves the primary via (user, workspace) and resumes its
   * current SDK session — ignoring `resumeSessionId`. The primary swaps to a
   * fresh session before its context fills, invisibly; the thread is unbroken.
   * Build brief Slice 1. (Phase 1: a backend flag; the per-workspace toggle UI
   * is Slice 2.)
   */
  continueRoot: z.boolean().optional(),
  // May be empty when at least one image is attached (image-only message); the
  // composer enforces "text or image". Capped to bound the request body.
  userMessageText: z.string().max(50000),
  attachedImages: z.array(AttachedImageInputSchema).max(MAX_ATTACHED_IMAGES).optional(),
  // The model to run this turn (the per-chat picker). Validated against the
  // curated allowlist; omit to inherit the Claude Code default.
  model: z
    .string()
    .refine((value) => CHAT_MODEL_IDS.includes(value), 'Unsupported model.')
    .optional(),
  // The user-facing session mode (values from SESSION_MODE_VALUES above). The
  // server maps it to the provider permission mode (`toPermissionMode`) and
  // resolves the default when omitted (the persisted setting, else `ask`).
  mode: z.enum(SESSION_MODE_VALUES).optional(),
})

export const RenameChatSessionRequestSchema = z.object({
  title: z.string().min(1).max(120),
})

export const ListChatSessionsQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const SearchChatSessionsQuerySchema = z.object({
  query: z.string().min(2).max(500),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns — the routes wire them into
// `describeRoute` responses via `resolver` so the OpenAPI spec (and
// therefore the generated SDK return types) are real, not `never`
// (knowledge-routes precedent). ZERO runtime change: these declare
// exactly what `c.json(row)` already emits — Drizzle rows with `Date`
// columns serialized to ISO strings, nullables preserved.

const ChatSessionVisibilitySchema = z.enum(['listed', 'hidden'])
const ChatSessionScopeSchema = z.enum(['global', 'workspace', 'agent'])
const ChatMessageRoleSchema = z.enum(['user', 'assistant', 'system'])
const ChatMessageSourceKindSchema = z.enum(['user', 'global-root', 'workspace-manager', 'agent'])
const ToolCallStatusSchema = z.enum(['started', 'completed', 'failed', 'denied', 'cancelled'])
const ApprovalStatusSchema = z.enum(['approved', 'denied', 'timed-out', 'cancelled'])

export const ChatSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null for a global-root (brain) segment — the brain sits above all workspaces.
  workspaceId: z.string().nullable(),
  providerId: z.string(),
  model: z.string().nullable(),
  title: z.string(),
  visibility: ChatSessionVisibilitySchema,
  scope: ChatSessionScopeSchema,
  isArchived: z.boolean(),
  deletedAt: z.string().nullable(),
  totalMessageCount: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  startedAt: z.string(),
  lastMessageAt: z.string(),
  updatedAt: z.string(),
})

// The list row = the session + a derived preview (repo correlated subquery).
export const ChatSessionListItemSchema = ChatSessionSchema.extend({
  lastMessagePreview: z.string().nullable(),
})

const AttachedImageMetadataSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
})

export const ChatMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: ChatMessageRoleSchema,
  body: z.string(),
  sourceKind: ChatMessageSourceKindSchema.nullable(),
  sourceLabel: z.string().nullable(),
  partialSessionId: z.string().nullable(),
  thinkingBody: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  attachedImagesMetadata: z.array(AttachedImageMetadataSchema).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const ChatToolCallSchema = z.object({
  id: z.string(),
  parentMessageId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  // Opaque-never-filtered JSON (D25) — the shape is tool-name-specific.
  toolInput: z.unknown(),
  toolOutput: z.unknown(),
  status: ToolCallStatusSchema,
  approvalStatus: ApprovalStatusSchema.nullable(),
  isErrorResult: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})

export const ChatMessageSearchResultSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  /** Body with `<mark>` highlight markers (FTS5 `snippet()` output). */
  snippet: z.string(),
  /** FTS5 rank (lower = better) or Postgres ts_rank. */
  rank: z.number(),
})

// Envelope schemas — the exact top-level JSON each route emits.
export const ListChatSessionsResponseSchema = z.array(ChatSessionListItemSchema)

export const SearchChatSessionsResponseSchema = z.array(ChatMessageSearchResultSchema)

export const ContinuingConversationResponseSchema = z.object({
  rootSessionId: z.string().nullable(),
  currentSdkSessionId: z.string().nullable(),
})

export const ChatSessionDetailResponseSchema = z.object({
  session: ChatSessionSchema,
  messages: z.array(ChatMessageSchema),
  toolCallsByMessageId: z.record(z.array(ChatToolCallSchema)),
})

export const SessionContextReportResponseSchema = z.object({
  report: z.string().nullable(),
})
