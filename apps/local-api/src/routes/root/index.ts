// The `root` HTTP surface (agent-base Slice 4) — the GLOBAL root's turn entry. Top-
// level + user-scoped (the global root has no workspace), so it does NOT nest under
// /workspaces/:workspaceId. The no-workspace sibling of the workspace chat turn.
//
//   GET  /continuing            -> resolve the global root conversation (landing helper)
//   GET  /transcript            -> the global root conversation history (cold-start hydration)
//   GET  /trace/:partialSessionId -> TIER 1: the condensed delegation trace
//   GET  /sessions/:sessionId   -> TIER 2: one owned session in full (trace drill-down)
//   GET  /delegations           -> the user's in-flight delegations (processing indicator)
//   POST /turn                  -> start a global-root turn; SSE stream (LLM-native routing)
//
// None opts into MCP: the turn is not a tool surface, and the reads are UI
// landing/liveness helpers. Locked Hono protocol: `describeRoute` from the local
// openapi.js wrapper, `validator` from `hono-openapi/zod`, chained methods on
// `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { listInFlightDelegations } from '@vynel/orchestration'
import { getChatSessionDetail } from '@vynel/chat'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { streamGlobalRootTurn } from '../../streams/global-root-turn.js'
import { resolveGlobalRootTranscript } from '../../sessions/resolve-global-root-transcript.js'
import { resolveDelegationTrace } from '../../sessions/resolve-delegation-trace.js'
import {
  StartGlobalRootTurnRequestSchema,
  DelegationTraceParamSchema,
  RootSessionParamSchema,
  ContinuingConversationResponseSchema,
  GlobalRootTranscriptResponseSchema,
  DelegationTraceResponseSchema,
  ChatSessionDetailResponseSchema,
  ListInFlightDelegationsResponseSchema,
} from './schemas.js'

export const rootApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /continuing — resolve the global root conversation (read-only;
  // nulls until the first global-root turn creates it). Wire keys keep
  // the source names (rootSessionId) — the root→primary rename is
  // package-side only.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/continuing',
    describeRoute({
      tags: ['root'],
      summary:
        'Resolve the global root conversation (read-only; nulls until the first global-root turn).',
      'x-sdk-name': 'root.getContinuing',
      responses: {
        200: {
          description: '{ rootSessionId, currentSdkSessionId } — nulls when no global root exists yet.',
          content: {
            'application/json': { schema: resolver(ContinuingConversationResponseSchema) },
          },
        },
      },
      // No x-mcp — a UI landing helper, not an agent tool surface.
    }),
    ...userScoped,
    (c) => {
      // workspaceId omitted → the global root.
      const root = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      return c.json({
        rootSessionId: root?.id ?? null,
        currentSdkSessionId: root?.currentSdkSessionId ?? null,
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /transcript — the global root conversation history (messages across
  // the swap-segment chain), for cold-start hydration of the global chat
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/transcript',
    describeRoute({
      tags: ['root'],
      summary: 'Get the global root conversation history (messages across swap segments).',
      'x-sdk-name': 'root.getTranscript',
      responses: {
        200: {
          description:
            '{ messages, toolCallsByMessageId } — the ordered message history + persisted tool calls keyed by message (empty until the first turn).',
          content: {
            'application/json': { schema: resolver(GlobalRootTranscriptResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => c.json(resolveGlobalRootTranscript(c.var.db, c.var.user.id)),
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /trace/:partialSessionId — TIER 1: the condensed delegation trace
  // (brain-tree Ch3). Owner-gated inside the core op (empty on miss/cross-user).
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/trace/:partialSessionId',
    describeRoute({
      tags: ['root'],
      summary: 'Get the condensed delegation trace for one request (by partialSessionId).',
      'x-sdk-name': 'root.getTrace',
      responses: {
        200: {
          description: '{ partialSessionId, entries } — the attributed chain; empty entries when unknown/not-owned.',
          content: {
            'application/json': { schema: resolver(DelegationTraceResponseSchema) },
          },
        },
      },
    }),
    validator('param', DelegationTraceParamSchema),
    ...userScoped,
    (c) => {
      const { partialSessionId } = c.req.valid('param')
      return c.json(resolveDelegationTrace(c.var.db, { userId: c.var.user.id, partialSessionId }))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId — TIER 2: a full session's detail (messages +
  // tool calls), OWNER-GATED (brain-tree Ch3, D1). 404 if missing or not owned
  // (no enumeration leak) — this route lacks the workspace chat ownership middleware.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId',
    describeRoute({
      tags: ['root'],
      summary: 'Get one owned session in full (messages + tool calls) — for the trace drill-down.',
      'x-sdk-name': 'root.getSession',
      responses: {
        200: {
          description: '{ session, messages, toolCallsByMessageId } — the full session detail.',
          content: {
            'application/json': { schema: resolver(ChatSessionDetailResponseSchema) },
          },
        },
        404: { description: 'No such session, or not owned by the caller.' },
      },
    }),
    validator('param', RootSessionParamSchema),
    ...userScoped,
    (c) => {
      const { sessionId } = c.req.valid('param')
      return c.json(getChatSessionDetail(c.var.db, sessionId, { ownerUserId: c.var.user.id }))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /delegations — the user's IN-FLIGHT delegations (pending + claimed),
  // for the /global "Vynel is processing…" indicator (brain-tree Ch3.5)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/delegations',
    describeRoute({
      tags: ['root'],
      summary: 'List the user\'s in-flight delegations (pending + claimed) for the processing indicator.',
      'x-sdk-name': 'root.listDelegations',
      responses: {
        200: {
          description:
            '{ delegations: [{ partialSessionId, workspaceName, status }] } — empty when idle.',
          content: {
            'application/json': { schema: resolver(ListInFlightDelegationsResponseSchema) },
          },
        },
      },
      // No x-mcp — a UI liveness indicator, not an agent tool surface.
    }),
    ...userScoped,
    (c) => c.json({ delegations: listInFlightDelegations(c.var.db, { userId: c.var.user.id }) }),
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /turn — start a global-root turn; SSE stream (LLM-native routing)
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/turn',
    describeRoute({
      tags: ['root'],
      summary:
        'Start a global-root turn (LLM-native routing); streams normalized session events via SSE.',
      'x-sdk-name': 'root.startTurn',
      responses: {
        200: { description: 'SSE stream of normalized session events.' },
      },
      // No x-mcp — SSE streaming is not a tool surface.
    }),
    validator('json', StartGlobalRootTurnRequestSchema),
    ...userScoped,
    async (c) => streamGlobalRootTurn(c, c.req.valid('json')),
  )
