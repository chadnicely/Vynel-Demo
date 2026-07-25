// Zod schemas for the monitors routes. Per `coding-standard.md` "Zod schemas" —
// XxxSchema suffix; API-internal (single consumer) lives beside the route.

import { z } from 'zod'
import {
  MONITOR_DESCRIPTION_MAX_LENGTH,
  MONITOR_MAX_EVENT_TYPES,
  MONITOR_MAX_FILTER_ENTRIES,
  MONITOR_MAX_TTL_MS,
} from '@vynel/monitors'

export const MonitorParamSchema = z.object({ monitorId: z.string().min(1) })

export const ListMonitorsQuerySchema = z.object({
  status: z.enum(['armed', 'fired', 'stopped', 'expired']).optional(),
})

// Bounds mirror the core op's (one home for the rule; these publish it into the
// OpenAPI spec and therefore into the MCP tool schema the model reads).
export const CreateMonitorRequestSchema = z.object({
  description: z.string().min(1).max(MONITOR_DESCRIPTION_MAX_LENGTH),
  eventTypes: z.array(z.string().min(1)).min(1).max(MONITOR_MAX_EVENT_TYPES),
  payloadFilter: z.record(z.string()).optional(),
  mode: z.enum(['once', 'recurring']).optional(),
  expiresInMs: z.number().int().positive().max(MONITOR_MAX_TTL_MS).optional(),
})

export const MonitorResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  ownerKind: z.enum(['global-root', 'workspace-primary', 'spawned-session']),
  description: z.string(),
  eventTypes: z.array(z.string()),
  payloadFilter: z.record(z.string()).nullable(),
  mode: z.enum(['once', 'recurring']),
  status: z.enum(['armed', 'fired', 'stopped', 'expired']),
  expiresAt: z.string(),
  firedCount: z.number(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
})

export const ListMonitorsResponseSchema = z.array(MonitorResponseSchema)

