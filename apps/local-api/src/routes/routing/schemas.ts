// Zod schemas for the routing routes (agent-base Slice 4). Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix; API-internal (single
// consumer) lives beside the route.
//
// Response schemas (knowledge-routes precedent): the routes wire them into
// `describeRoute` via `resolver` so the OpenAPI spec — and therefore the generated
// SDK return types — are real, not `never`. ZERO runtime change: these declare
// exactly what each handler already emits.

import { z } from 'zod'
import { CHAT_MODEL_IDS } from '@vynel/contracts/chat/chat-models'
import { THINKING_EFFORT_LEVELS } from '@vynel/contracts/chat/thinking-effort'

// The root's model/effort picks for the delegated turn (shared by both delegate
// routes). BOTH fields are z.enum — an enum flows the curated allowlist into the
// OpenAPI spec and the generated MCP tool schema, which here IS the UI: the
// delegating agent can only pick ids it can see (the cf15137 review catch — a
// `.refine` published a bare string, leaving the model half unguessable). The
// composer routes keep their refine (a UI picker constrains those).
const DelegationRunPreferenceFields = {
  /** The model to run the delegated turn. Omit to inherit the provider default. */
  model: z.enum(CHAT_MODEL_IDS).optional(),
  /** Reasoning effort for the delegated turn. Omit for the adaptive default. */
  thinkingEffort: z.enum(THINKING_EFFORT_LEVELS).optional(),
}

export const RouteToWorkspaceRequestSchema = z.object({
  /** The workspace to route the task to (from list_routing_workspaces). */
  targetWorkspaceId: z.string().min(1),
  /** The task to route down — becomes a turn on the workspace root's brain. */
  task: z.string().min(1).max(50000),
  ...DelegationRunPreferenceFields,
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

export const SendTaskToSessionRequestSchema = z.object({
  /** The target session — the id list_sessions shows / create_session returned. */
  targetSessionId: z.string().min(1),
  /** The task to send — becomes a turn on the spawned session's conversation. */
  task: z.string().min(1).max(50000),
  /** Slice ④b: the CALLING workspace (ownership-checked) — the job's parent is
   *  then that workspace's primary conversation, so the report returns to the
   *  creator. Absent = a global-root call (the shipped v1 behavior). The
   *  workspace surface stamps this ambiently from the turn's scope. */
  workspaceId: z.string().min(1).optional(),
  ...DelegationRunPreferenceFields,
})

export const SendTaskToSessionResponseSchema = z.object({
  status: z.literal('enqueued'),
  jobId: z.string(),
  sessionName: z.string(),
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
