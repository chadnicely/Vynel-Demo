// Zod response schemas for the `sessions` surface — mirrors
// `@vynel/contracts/chat/sessions-overview` (the wire vocabulary; the schema
// is the HTTP boundary's validation of the same shape).

import { z } from 'zod'
import { ChatModelIdSchema } from '@vynel/contracts/chat/chat-models'
import { THINKING_EFFORT_LEVELS } from '@vynel/contracts/chat/thinking-effort'
import { SESSION_MODES, type SessionMode } from '@vynel/session'

export const SessionsOverviewSegmentSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  startedAt: z.string(),
  lastMessageAt: z.string(),
  contextTokens: z.number().int().nullable(),
  continuedFromSessionId: z.string().nullable(),
  isCurrent: z.boolean(),
})

export const SessionsOverviewEntrySchema = z.object({
  sessionId: z.string(),
  scope: z.enum(['global', 'workspace', 'agent', 'spawned']),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  title: z.string(),
  model: z.string().nullable(),
  contextTokens: z.number().int().nullable(),
  contextWindow: z.number().int(),
  lastMessageAt: z.string(),
  segments: z.array(SessionsOverviewSegmentSchema),
})

export const SessionsOverviewResponseSchema = z.array(SessionsOverviewEntrySchema)

// ── Spawned sessions (session-library Slice ④) ─────────────────────

export const CreateSpawnedSessionRequestSchema = z.object({
  /** The session's display name — its identity in the Sessions panel. */
  name: z.string().min(1).max(120),
  /** What the session is for — primed into it as carried context. */
  purpose: z.string().min(1).max(50000),
  /** Slice ④b: the creating workspace — the session inherits ITS ground (path,
   *  memory, skills). Absent = global-grounded (the shipped v1 behavior). The
   *  workspace surface stamps this ambiently from the turn's scope. */
  workspaceId: z.string().min(1).optional(),
})

export const CreateSpawnedSessionResponseSchema = z.object({
  status: z.literal('created'),
  /** The session id — the handle `list_sessions` shows and `send_message`'s
   *  `"session:<sessionId>"` destination accepts. */
  sessionId: z.string(),
  name: z.string(),
})

// ── Cross-session conversation reads (2026-08-10) ──────────────────
// The user-scoped homes of `search_chat_messages` + `get_chat_session` —
// every tier (workspace root, spawned/agent sessions, global root) reads any
// owned session's conversation through these. Response shapes are the chat
// surface's (re-exported below) — one detail envelope everywhere.

export const SearchSessionMessagesQuerySchema = z.object({
  query: z.string().min(2).max(500),
  /** Restrict hits to one workspace's sessions; omitted = the whole system. */
  workspaceId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export {
  SearchChatSessionsResponseSchema,
  ChatSessionDetailResponseSchema,
} from '../chat/schemas.js'

// ── Interactive session turns (sessions-surface Slice ③a) ──────────

// Derived from @vynel/session's canonical SESSION_MODES so the route enum
// can't drift from the SessionMode union (the chat-schemas precedent).
const SESSION_MODE_VALUES = SESSION_MODES.map((entry) => entry.mode) as [
  SessionMode,
  ...SessionMode[],
]

export const StartSessionTurnRequestSchema = z.object({
  /** The user's message — a direct turn into the spawned session's chain head. */
  userMessageText: z.string().min(1).max(50000),
  /** The model to run this turn. Omit to resolve the session's persisted
   *  setting, else the provider default. */
  model: ChatModelIdSchema.optional(),
  /** Reasoning effort for this turn. Omit to resolve the session's persisted
   *  setting, else the adaptive default. */
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).optional(),
  /** The user-facing session mode — `toPermissionMode` after resolving
   *  input ?? the session's persisted setting ?? `DEFAULT_SESSION_MODE`. */
  mode: z.enum(SESSION_MODE_VALUES).optional(),
  /** The composer's Auto-buildout toggle — write-through persistence only
   *  (nothing consumes it yet); rides the turn so a NEW conversation's first
   *  turn stamps the row it creates. */
  autoBuildout: z.boolean().optional(),
})

// ── Per-session composer settings (2026-08-17) ─────────────────────
// What the user CHOSE for this session — nullable means "never set on this
// session"; the UI falls back to its local defaults, the turn streams to
// their surface defaults. One settings surface for every scope the composer
// hosts (global segments, workspace sessions, spawned sessions).

export const ChatSessionSettingsSchema = z.object({
  sessionMode: z.enum(SESSION_MODE_VALUES).nullable(),
  selectedModel: z.string().nullable(),
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).nullable(),
  autoBuildout: z.boolean().nullable(),
})

export const UpdateChatSessionSettingsRequestSchema = z.object({
  sessionMode: z.enum(SESSION_MODE_VALUES).optional(),
  selectedModel: ChatModelIdSchema.optional(),
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).optional(),
  autoBuildout: z.boolean().optional(),
})
