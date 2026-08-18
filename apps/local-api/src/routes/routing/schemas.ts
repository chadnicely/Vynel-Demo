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

// The sender's model/effort picks for a delegated turn (send_message task
// sends). The generated MCP tool schema here IS the UI (the cf15137 review
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
    /^(requester|global|workspace:.+|session:.+)$/,
    'to must be "requester", "global", "workspace:<workspaceId>", or "session:<sessionId>"',
  )

export const SendMessageRequestSchema = z.object({
  to: MessageDestinationSchema,
  /** The task to hand down, the note to pass across, or the result/status to
   *  pass back up. */
  body: z.string().min(1).max(50000),
  /** What the message IS. Downward: omitted derives 'task' for a
   *  workspace/session target; 'note' (the lateral kind) sends plain
   *  COMMUNICATION to the same targets — no run, no report expected, nothing
   *  tracked. Upward (persona-sessions): 'report' = the FINAL result (marks
   *  the running task reported); 'update' = an interim ack/progress line
   *  (never marks it — the task stays running); 'direct_to_user' = the FINAL
   *  answer addressed to the USER — shown verbatim as your message, never
   *  narrated (requires `title`; marks the task reported). Omitted = 'report'
   *  for "requester". */
  kind: z.enum(['task', 'note', 'report', 'update', 'direct_to_user']).optional(),
  /** REQUIRED with kind 'direct_to_user' (rejected otherwise): the short
   *  headline the user's message box shows — the full text opens from it. */
  title: z.string().min(1).max(200).optional(),
  /** The CALLING workspace for either task destination (Slice ④b,
   *  ownership-checked) — the job parents on that workspace's primary
   *  conversation and records it as the requester, so the target's updates and
   *  report return to the chat that asked instead of the global root. The
   *  workspace surface stamps this ambiently from the turn's scope (the
   *  generator's workspaceId fallback); absent = a global-root call, where
   *  recording no requester IS how the chain terminates at the root. */
  workspaceId: z.string().min(1).optional(),
  ...DelegationRunPreferenceFields,
})

export const SendMessageResponseSchema = z.object({
  status: z.literal('enqueued'),
  jobId: z.string(),
  /** What the message was addressed to, resolved — the workspace/session name,
   *  or the requester's label. Lets the caller confirm where it actually went. */
  deliveredTo: z.string(),
  /** 'task' when sent down to a workspace/session; 'note' for plain
   *  communication across; 'report'/'update'/'direct_to_user' when passed up. */
  kind: z.enum(['task', 'note', 'report', 'update', 'direct_to_user']),
})

// ── Delegated tasks (reading back a handed-off task) ────────────────
// Renamed from "background runs" (Kafi, 2026-08-17): that phrase reads as an
// OS/shell background process; what these actually read is a task you SENT.

/** The agent-facing status vocabulary — NOT the queue's storage union
 *  (`claimed` describes a compare-and-swap and means nothing to a model). */
const DelegatedTaskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed'])

export const DelegatedTaskSchema = z.object({
  jobId: z.string(),
  status: DelegatedTaskStatusSchema,
  target: z.string(),
  taskLabel: z.string(),
  partialSessionId: z.string().nullable(),
  enqueuedAt: z.string(),
  finishedAt: z.string().nullable(),
  resultPreview: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

export const ListDelegatedTasksResponseSchema = z.array(DelegatedTaskSchema)

export const DelegatedTaskDetailSchema = DelegatedTaskSchema.omit({ resultPreview: true }).extend({
  result: z.string().nullable(),
  taskText: z.string(),
})
