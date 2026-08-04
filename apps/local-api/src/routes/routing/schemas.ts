// Zod schemas for the routing routes (agent-base Slice 4). Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix; API-internal (single
// consumer) lives beside the route.
//
// Response schemas (knowledge-routes precedent): the routes wire them into
// `describeRoute` via `resolver` so the OpenAPI spec — and therefore the generated
// SDK return types — are real, not `never`. ZERO runtime change: these declare
// exactly what each handler already emits.

import { z } from 'zod'
import { ChatModelIdSchema } from '@vynel/contracts/chat/chat-models'
import { THINKING_EFFORT_LEVELS } from '@vynel/contracts/chat/thinking-effort'

// The root's model/effort picks for the delegated turn (shared by both delegate
// routes). The generated MCP tool schema here IS the UI (the cf15137 review
// catch — the delegating agent must be able to learn legal values). Since the
// roster went dynamic, the model field is shape-validated; the TOOL
// descriptions point the agent at `list_available_chat_models` (the generator
// flattens field-level describe text, so the tool text carries it). Effort
// stays a real enum.
const DelegationRunPreferenceFields = {
  /** The model to run the delegated turn. Omit to inherit the provider default. */
  model: ChatModelIdSchema.optional(),
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

// The reply carries NO address — where it goes is the turn's server-stamped
// ambient origin (a mis-addressed reply is unrecoverable once enqueued; the
// `to: "requester"` precedent).
export const ReplyToChannelRequestSchema = z.object({
  /** The answer, delivered to the exact conversation this turn came from. */
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

// session-comms: the upward report. DELIBERATELY only the report body — the
// requester is resolved server-side from the calling turn's identity header
// (fork 2: no ids in the tool input = no mis-addressing, no cycles).
export const ReportToRequesterRequestSchema = z.object({
  /** The real result to pass up — findings, numbers, paths; not just "done". */
  report: z.string().min(1).max(50000),
})

export const ReportToRequesterResponseSchema = z.object({
  status: z.literal('enqueued'),
  jobId: z.string(),
})

// Local enum (the root-schemas precedent of redeclaring small unions) — the
// channels route file keeps its ChannelKindSchema private.
const RoutingChannelKindSchema = z.enum(['telegram', 'discord', 'zoom'])

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

export const ReplyToChannelResponseSchema = z.object({
  status: z.literal('sent'),
  /** The channel's display name — where the reply is going. */
  deliveredTo: z.string(),
})

// ── The unified session-messaging tool ──────────────────────────────

/** Where a message goes. `requester` carries NO id on purpose: who asked is
 *  resolved server-side from the caller header, never from model input — a
 *  mis-set requester would deliver a result to the wrong conversation, and it
 *  is unrecoverable once sent. `to` names a destination the model legitimately
 *  CHOSE; it never names who asked. */
export const MessageDestinationSchema = z
  .string()
  .min(1)
  .regex(
    /^(requester|workspace:.+|session:.+)$/,
    'to must be "requester", "workspace:<workspaceId>", or "session:<sessionId>"',
  )

export const SendMessageRequestSchema = z.object({
  to: MessageDestinationSchema,
  /** The task to hand down, or the result/status to pass back up. */
  body: z.string().min(1).max(50000),
  /** UPWARD messages only (persona-sessions): 'report' = the FINAL result
   *  (marks the running task reported); 'update' = an interim ack/progress
   *  line (never marks it — the task stays running). Omitted = 'report' for
   *  "requester", derived 'task' for a workspace/session target. */
  kind: z.enum(['task', 'report', 'update']).optional(),
  ...DelegationRunPreferenceFields,
})

export const SendMessageResponseSchema = z.object({
  status: z.literal('enqueued'),
  jobId: z.string(),
  /** What the message was addressed to, resolved — the workspace/session name,
   *  or the requester's label. Lets the caller confirm where it actually went. */
  deliveredTo: z.string(),
  /** 'task' when sent down to a workspace/session; 'report'/'update' when
   *  passed up. */
  kind: z.enum(['task', 'report', 'update']),
})

// ── Background runs (reading back a handed-off task) ────────────────

/** The agent-facing status vocabulary — NOT the queue's storage union
 *  (`claimed` describes a compare-and-swap and means nothing to a model). */
const BackgroundRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed'])

export const BackgroundRunSchema = z.object({
  jobId: z.string(),
  status: BackgroundRunStatusSchema,
  target: z.string(),
  taskLabel: z.string(),
  partialSessionId: z.string().nullable(),
  enqueuedAt: z.string(),
  finishedAt: z.string().nullable(),
  resultPreview: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

export const ListBackgroundRunsResponseSchema = z.array(BackgroundRunSchema)

export const BackgroundRunDetailSchema = BackgroundRunSchema.omit({ resultPreview: true }).extend({
  result: z.string().nullable(),
  taskText: z.string(),
})
