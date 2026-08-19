// The `root` HTTP surface (agent-base Slice 4) — the GLOBAL root's turn entry. Top-
// level + user-scoped (the global root has no workspace), so it does NOT nest under
// /workspaces/:workspaceId. The no-workspace sibling of the workspace chat turn.
//
//   GET  /continuing            -> resolve the global root conversation (landing helper)
//   GET  /transcript            -> the global root conversation history (cold-start hydration)
//   GET  /voice-chat/*          -> the spoken thread's own doors (voice-chat.ts)
//   GET  /trace/* + /delegations* -> the delegation-observability doors (delegations.ts)
//   GET  /sessions/:sessionId   -> TIER 2: one owned session in full (trace drill-down)
//   GET  /sessions/:sessionId/transcript -> a folded chain's full history (Sessions panel)
//   POST /turn                  -> start a global-root turn; SSE stream (LLM-native routing)
//   POST /turn/interrupt        -> stop a running global/voice turn (interrupt.ts)
//
// None opts into MCP: the turn is not a tool surface, and the reads are UI
// landing/liveness helpers. Locked Hono protocol: `describeRoute` from the local
// openapi.js wrapper, `validator` from `hono-openapi/zod`, chained methods on
// `factory.createApp()`. The voice doors, the interrupt and the delegation
// reads live in their own files and compose here via `.route('/', ...)` (the
// `files` sub-app idiom) — the split brought a 503-line file back inside the
// size cap (session-hardening D4).

import { resolver, validator } from 'hono-openapi/zod'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { getChatSessionDetail } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { streamGlobalRootTurn } from '../../streams/global-root-turn.js'
import { voiceChatRoutes } from './voice-chat.js'
import { interruptRoutes } from './interrupt.js'
import { delegationRoutes } from './delegations.js'
import {
  resolvePrimaryTranscript,
  resolveSessionChainTranscript,
} from '@vynel/session/runtime'
import {
  enrichChatSessionDetail,
  enrichPrimaryTranscript,
} from '../../sessions/enrich-chat-session-detail.js'
import {
  StartGlobalRootTurnRequestSchema,
  RootSessionParamSchema,
  ContinuingConversationResponseSchema,
  ContinuingTranscriptResponseSchema,
  ChatSessionDetailResponseSchema,
} from './schemas.js'

export const rootApp = factory
  .createApp()
  .route('/', voiceChatRoutes)
  .route('/', interruptRoutes)
  .route('/', delegationRoutes)
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
          description:
            '{ rootSessionId, currentSdkSessionId, lastMessageAt } — nulls when no global root exists yet.',
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
      const currentSessionId = root?.currentSdkSessionId ?? null
      const current =
        currentSessionId === null ? null : findChatSessionById(c.var.db, currentSessionId)
      return c.json({
        rootSessionId: root?.id ?? null,
        currentSdkSessionId: currentSessionId,
        lastMessageAt: current?.lastMessageAt.toISOString() ?? null,
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /transcript — the global root conversation history (messages across
  // the swap-segment chain), for the continuing global thread. Serves the
  // session-detail envelope (session = the CURRENT segment, enriched like
  // `root.getSession`) so the thread renders through the same pipeline.
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
            '{ session, messages, toolCallsByMessageId } — the current segment (null until the first turn) + the chain-spanning message history.',
          content: {
            'application/json': { schema: resolver(ContinuingTranscriptResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) =>
      c.json(
        enrichPrimaryTranscript(
          c.var.db,
          resolvePrimaryTranscript(c.var.db, { userId: c.var.user.id }),
        ),
      ),
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
      const detail = getChatSessionDetail(c.var.db, c.req.valid('param').sessionId, {
        ownerUserId: c.var.user.id,
      })
      return c.json(enrichChatSessionDetail(c.var.db, detail))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId/transcript — a folded chain's full history,
  // opened by its newest segment (the id the sessions overview keys every
  // chain by). The Sessions panel reads THIS for a followed chain: a spawned
  // session's compaction swap repoints the chain at a fresh, empty segment —
  // the single-segment read then showed an empty conversation (the same shape
  // the continuing threads had). Owner-gated like /sessions/:sessionId.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId/transcript',
    describeRoute({
      tags: ['root'],
      summary: "Get one owned session's chain-spanning history (messages across swap segments).",
      'x-sdk-name': 'root.getSessionTranscript',
      responses: {
        200: {
          description:
            '{ session, messages, toolCallsByMessageId } — the head segment + messages across its whole continuation chain.',
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
      const transcript = resolveSessionChainTranscript(c.var.db, {
        userId: c.var.user.id,
        headSessionId: c.req.valid('param').sessionId,
      })
      return c.json(enrichChatSessionDetail(c.var.db, transcript))
    },
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
