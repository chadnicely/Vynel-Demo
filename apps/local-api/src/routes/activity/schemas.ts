// Zod schemas for the `/activity` surface — the node screen's message edges.
// (The durable running-turns read was removed with its route: after a restart
// every turn is reaped, so there was nothing to rebuild from and no caller.)

import { z } from 'zod'

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
