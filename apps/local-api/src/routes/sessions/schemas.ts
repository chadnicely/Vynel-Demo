// Zod response schemas for the `sessions` surface — mirrors
// `@vynel/contracts/chat/sessions-overview` (the wire vocabulary; the schema
// is the HTTP boundary's validation of the same shape).

import { z } from 'zod'

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
