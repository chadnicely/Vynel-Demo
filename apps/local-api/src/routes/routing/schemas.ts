// Zod schemas for the routing routes (agent-base Slice 4). Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix; API-internal (single
// consumer) lives beside the route.
//
// Response schemas (knowledge-routes precedent): the routes wire them into
// `describeRoute` via `resolver` so the OpenAPI spec — and therefore the generated
// SDK return types — are real, not `never`. ZERO runtime change: these declare
// exactly what each handler already emits.

import { z } from 'zod'

export const RouteToWorkspaceRequestSchema = z.object({
  /** The workspace to route the task to (from list_routing_workspaces). */
  targetWorkspaceId: z.string().min(1),
  /** The task to route down — becomes a turn on the workspace root's brain. */
  task: z.string().min(1).max(50000),
})

export const SendToChannelRequestSchema = z.object({
  /** The channel to send to (from list_routing_channels). */
  channelId: z.string().min(1),
  /** The message body delivered to the channel's owner. */
  message: z.string().min(1).max(50000),
})

// ── Response schemas ────────────────────────────────────────────────

/** One routing target — the (id, name) pair the global root picks from. */
export const RoutingWorkspaceTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const ListRoutingWorkspacesResponseSchema = z.array(RoutingWorkspaceTargetSchema)

export const RouteToWorkspaceResponseSchema = z.object({
  status: z.literal('enqueued'),
  jobId: z.string(),
  workspaceName: z.string(),
})

// Local enum (the root-schemas precedent of redeclaring small unions) — the
// channels route file keeps its ChannelKindSchema private.
const RoutingChannelKindSchema = z.enum(['telegram', 'discord'])

/** One channel send target — id + display name + kind. */
export const RoutingChannelTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RoutingChannelKindSchema,
})

export const ListRoutingChannelsResponseSchema = z.array(RoutingChannelTargetSchema)

export const SendToChannelResponseSchema = z.object({
  status: z.literal('sent'),
  channelId: z.string(),
})
