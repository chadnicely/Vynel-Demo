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
  scope: z.enum(['global', 'workspace', 'agent']),
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
