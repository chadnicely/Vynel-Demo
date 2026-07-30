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
  /** The session id — the handle `list_sessions` shows and
   *  `send_task_to_session` accepts. */
  sessionId: z.string(),
  name: z.string(),
})

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
  /** The model to run this turn. Omit to inherit the provider default. */
  model: ChatModelIdSchema.optional(),
  /** Reasoning effort for this turn. Omit for the adaptive default. */
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).optional(),
  /** The user-facing session mode — same resolution as the workspace chat
   *  stream (`toPermissionMode`, default `DEFAULT_SESSION_MODE` when omitted). */
  mode: z.enum(SESSION_MODE_VALUES).optional(),
})
