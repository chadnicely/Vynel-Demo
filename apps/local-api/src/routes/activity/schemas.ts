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
