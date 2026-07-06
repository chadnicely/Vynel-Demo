// Zod schemas for the global-root routes (agent-base Slice 4). Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix; API-internal lives beside
// the route. The global root has no workspace, no attachments, and always continues
// its own thread, so the request shape is minimal (text + optional model).
//
// Response schemas (knowledge-routes precedent): the routes wire them into
// `describeRoute` via `resolver` so the OpenAPI spec — and therefore the generated
// SDK return types — are real, not `never`. ZERO runtime change: these declare
// exactly what each handler already emits. The session-detail + continuing shapes
// are CHAT's wire shapes (the root reads the same core ops), so they are imported
// from the chat route's schemas — one home per shape, no drift.

import { z } from 'zod'
import { CHAT_MODEL_IDS } from '@vynel/contracts/chat/chat-models'
import { SESSION_MODES, type SessionMode } from '@vynel/session'
import { ChatToolCallSchema } from '../chat/schemas.js'

export {
  ContinuingConversationResponseSchema,
  ChatSessionDetailResponseSchema,
} from '../chat/schemas.js'

// Derived from @vynel/session's canonical SESSION_MODES so the route enum can't
// drift from the SessionMode union (the chat-schemas precedent).
const SESSION_MODE_VALUES = SESSION_MODES.map((entry) => entry.mode) as [SessionMode, ...SessionMode[]]

export const StartGlobalRootTurnRequestSchema = z.object({
  /** The user's message to the global brain (a routing request). */
  userMessageText: z.string().min(1).max(50000),
  /** The model to run this turn. Validated against the curated allowlist. */
  model: z
    .string()
    .refine((value) => CHAT_MODEL_IDS.includes(value), 'Unsupported model.')
    .optional(),
  // The user-facing session mode (surface-up step 1). Governs the brain's own tools
  // this turn AND is threaded onto any delegation it enqueues (the mode header →
  // `delegation_jobs.permissionMode`). Omitted → the brain's bypass default.
  mode: z.enum(SESSION_MODE_VALUES).optional(),
})

/** Path param for the tier-1 delegation-trace read (brain-tree Ch3). */
export const DelegationTraceParamSchema = z.object({
  partialSessionId: z.string().min(1),
})

/** Path param for the tier-2 full-session read (brain-tree Ch3). */
export const RootSessionParamSchema = z.object({
  sessionId: z.string().min(1),
})

// ── Response schemas ────────────────────────────────────────────────

const TranscriptMessageRoleSchema = z.enum(['user', 'assistant', 'system'])
const TranscriptSourceKindSchema = z.enum(['user', 'global-root', 'workspace-manager', 'agent'])

// The lean, attributed transcript DTO (`resolveGlobalRootTranscript`) — not the
// raw chat_messages row.
export const GlobalRootTranscriptMessageSchema = z.object({
  id: z.string(),
  role: TranscriptMessageRoleSchema,
  body: z.string(),
  sourceKind: TranscriptSourceKindSchema.nullable(),
  sourceLabel: z.string().nullable(),
  partialSessionId: z.string().nullable(),
})

export const GlobalRootTranscriptResponseSchema = z.object({
  messages: z.array(GlobalRootTranscriptMessageSchema),
  toolCallsByMessageId: z.record(z.array(ChatToolCallSchema)),
})

const DelegationJobStatusSchema = z.enum(['pending', 'claimed', 'completed', 'failed'])
const TraceEntryScopeSchema = z.enum(['global', 'workspace'])

// One condensed trace entry (`resolveDelegationTrace`) — a light row, not a
// heavy session. `createdAt` is the Date column serialized to an ISO string.
export const DelegationTraceEntrySchema = z.object({
  id: z.string(),
  role: TranscriptMessageRoleSchema,
  sourceKind: TranscriptSourceKindSchema.nullable(),
  sourceLabel: z.string().nullable(),
  body: z.string(),
  sessionId: z.string(),
  scope: TraceEntryScopeSchema,
  // The assistant entry's tool calls — live rows the Watch panel renders mid-turn.
  toolCalls: z.array(ChatToolCallSchema),
  createdAt: z.string(),
})

export const DelegationTraceResponseSchema = z.object({
  partialSessionId: z.string(),
  // Null when the key is unknown / not owned (the empty trace).
  status: DelegationJobStatusSchema.nullable(),
  entries: z.array(DelegationTraceEntrySchema),
})

export const InFlightDelegationSchema = z.object({
  // Null only for a (Ch2-precluded) job with no key; still counted as live work.
  partialSessionId: z.string().nullable(),
  // The target workspace — the workspace chat polls its transcript while this runs.
  workspaceId: z.string(),
  workspaceName: z.string(),
  status: z.enum(['pending', 'claimed']),
})

export const ListInFlightDelegationsResponseSchema = z.object({
  delegations: z.array(InFlightDelegationSchema),
})
