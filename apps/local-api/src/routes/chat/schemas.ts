// Zod request schemas for chat routes. Per `coding-standard.md` "Zod schemas"
// — XxxSchema suffix; API-internal (single consumer) lives here under the
// route folder. Not promoted to `@vynel/contracts/chat/*` in Phase 1
// (apps/web is the first consumer; promote on the second per the
// contracts-exports-map decision).
//
// Per blueprint §7.1.

import { z } from 'zod'
import { ChatModelIdSchema } from '@vynel/contracts/chat/chat-models'
import { THINKING_EFFORT_LEVELS } from '@vynel/contracts/chat/thinking-effort'
import { SESSION_MODES, type SessionMode } from '@vynel/session'

// ~5 MB once base64 is decoded (base64 inflates ~4/3). Per-attachment, generous
// for pasted screenshots while bounding a single JSON turn POST.
const MAX_IMAGE_BASE64_LENGTH = 7_000_000
export const MAX_ATTACHED_IMAGES = 6

// What the chat composer may attach. Images render inline for the agent as
// `[Image: path]`; documents as `[Attached file: path]` — both read off disk by
// the agent's own tools (handle-attached-images). Fail-closed: anything not
// listed is rejected at the boundary (no .exe riding a chat turn). The UI maps
// picked-file extensions to these (browsers report "" for e.g. `.md`).
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const

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
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  /** The attachment bytes, base64-encoded. */
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
  // The model to run this turn (the per-chat picker). Shape-validated — the
  // legal values are discovered (providers.listModels); omit to inherit the
  // Claude Code default.
  model: ChatModelIdSchema.optional(),
  // Reasoning effort for this turn (the composer's picker; Slice ③). Omitted =
  // Auto (the SDK's adaptive default — unchanged behavior).
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).optional(),
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
  // The inbound channel a USER row arrived through; null = the app composer.
  originChannel: z.enum(['voice', 'telegram', 'discord', 'zoom']).nullable(),
  partialSessionId: z.string().nullable(),
  // Serve-time enrichment (both session-detail reads — root AND workspace, one
  // content contract): the delegated task's short label for the Watch chip.
  // Optional — ordinary rows and unenriched routes omit it.
  delegationTaskLabel: z.string().nullable().optional(),
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

// One SUBAGENT tool call persisted on its spawning Agent call's row — lean
// (no output) by design; the settled source for the nested activity pane.
export const SubagentToolCallSchema = z.object({
  toolUseId: z.string(),
  toolName: z.string(),
  toolInput: z.unknown(),
  status: z.enum(['started', 'completed', 'failed']),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})

// The delegation a session-comms dispatch call enqueued — attached at
// detail-serve time (attachDelegationToolOutcomes), the thread's persistent
// door to that delegation's trace after the processing banner is gone. The
// DIRECT hop only — pipeline scoping (Chad, locked 2026-07-27).
export const DelegationToolOutcomeSchema = z.object({
  jobId: z.string(),
  partialSessionId: z.string().nullable(),
  status: z.enum(['pending', 'claimed', 'completed', 'failed']),
  deliveredTo: z.string().nullable(),
  taskLabel: z.string().nullable(),
  reportedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
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
  // Subagent activity persisted on a spawning Agent/Task call; null on
  // ordinary calls. Optional so pre-persistence payload shapes stay valid.
  subagentNarrative: z.string().nullable().optional(),
  subagentToolCalls: z.array(SubagentToolCallSchema).nullable().optional(),
  // Present on send_message / send_task_* calls only (serve-time enrichment).
  delegation: DelegationToolOutcomeSchema.nullable().optional(),
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
