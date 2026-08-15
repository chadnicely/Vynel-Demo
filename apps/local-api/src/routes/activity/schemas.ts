// Zod schemas for the `/activity` surface (persona-sessions): the durable
// running-turns read — the refresh/restart rebuild seed for the live views.

import { z } from 'zod'

export const RunningSessionTurnSchema = z.object({
  turnId: z.string(),
  scopeKind: z.enum(['global', 'workspace']),
  workspaceId: z.string().nullable(),
  origin: z.enum(['web', 'voice', 'telegram', 'discord', 'zoom', 'schedule', 'delegation']),
  sessionId: z.string().nullable(),
  primarySessionId: z.string().nullable(),
  jobId: z.string().nullable(),
  threadId: z.string().nullable(),
  partialSessionId: z.string().nullable(),
  /** ISO-8601. */
  startedAt: z.string(),
})

export const RunningSessionTurnsResponseSchema = z.object({
  turns: z.array(RunningSessionTurnSchema),
})

// The message edges the node screen draws a line for — who spoke to whom, just
// now. Endpoints are reported, never resolved: the drawing surface matches the
// ids against whatever it is showing, and an unmatched endpoint is the core.
export const MessageEdgeSchema = z.object({
  jobId: z.string(),
  direction: z.enum(['ask', 'reply']),
  fromSessionId: z.string(),
  toSessionId: z.string().nullable(),
  fromWorkspaceId: z.string().nullable(),
  toWorkspaceId: z.string().nullable(),
  /** ISO-8601. */
  at: z.string(),
})

export const RecentMessageEdgesResponseSchema = z.object({
  edges: z.array(MessageEdgeSchema),
})

export const RecentMessageEdgesQuerySchema = z.object({
  /** How far back to look. Clamped server-side — this feeds a short-lived
   *  animation, never a history view. */
  withinSeconds: z.coerce.number().int().min(1).max(600).optional(),
})
