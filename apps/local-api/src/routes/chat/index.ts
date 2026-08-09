// The `chat` HTTP surface — 12 routes mounted under
// `/workspaces/:workspaceId/chat/…` from `apps/local-api/src/app.ts` (D21).
//
// Workspace-scoped (use `...workspaceScoped`):
//   GET    /sessions                            -> listChatSessionsForWorkspace [x-mcp]
//   GET    /sessions/search                     -> searchChatSessions           [x-mcp]
//   GET    /continuing                          -> findPrimaryConversation
//   POST   /sessions/turn                       -> streamChatTurn (SSE stream)
//
// Session-scoped (use `...sessionScoped` — triple-check user+workspace+session):
//   GET    /sessions/:sessionId                 -> getChatSessionDetail         [x-mcp]
//   GET    /sessions/:sessionId/images/:filename -> readAttachedImageBytes
//   GET    /sessions/:sessionId/context         -> fetchSessionContextReport
//   PATCH  /sessions/:sessionId                 -> renameChatSession
//   POST   /sessions/:sessionId/archive         -> archiveChatSession
//   POST   /sessions/:sessionId/unarchive       -> unarchiveChatSession
//   POST   /sessions/:sessionId/interrupt       -> interruptChatSession
//   DELETE /sessions/:sessionId                 -> softDeleteChatSession
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" + `sdk-mcp.md`:
// `describeRoute` from the local openapi.js wrapper (widens for x-mcp +
// x-sdk-name); `validator` from `hono-openapi/zod`; chained methods on
// `factory.createApp()`. Order: describeRoute → validator → handler-bundle →
// async handler (matches the workspaces / skills precedent).
//
// Phase 1 MCP exposure: safe-read GETs only per D26 (rename / archive /
// unarchive / interrupt / soft-delete defer x-mcp to Phase 1.5 + per-route
// scope review).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { sessionScoped } from '../../handler-bundles/session-scoped.js'
import {
  listChatSessionsForWorkspace,
  searchChatSessions,
  getChatSessionDetail,
  renameChatSession,
  archiveChatSession,
  unarchiveChatSession,
  softDeleteChatSession,
  interruptChatSession,
  readAttachedImageBytes,
} from '@vynel/chat'
import { findPrimaryConversation } from '@vynel/session/continuity'
import {
  attachDelegationTaskLabels,
  attachDeliveredRunStats,
  attachDelegationToolOutcomes,
} from '@vynel/session/delegation'
import type { AiAgentProviderId } from '@vynel/providers'
import { streamChatTurn } from '../../streams/chat-turn.js'
import { fetchSessionContextReport } from './fetch-context-report.js'
import {
  ListChatSessionsQuerySchema,
  SearchChatSessionsQuerySchema,
  StartChatTurnRequestSchema,
  RenameChatSessionRequestSchema,
  ListChatSessionsResponseSchema,
  SearchChatSessionsResponseSchema,
  ContinuingConversationResponseSchema,
  ChatSessionDetailResponseSchema,
  SessionContextReportResponseSchema,
  ChatSessionSchema,
} from './schemas.js'

export const chatApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions — list (workspace-scoped)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions',
    describeRoute({
      tags: ['chat'],
      summary:
        'List chat sessions for the workspace (owner-scoped, excludes soft-deleted by default).',
      'x-sdk-name': 'chat.listSessions',
      responses: {
        200: {
          description: 'Array of ChatSession (+ lastMessagePreview).',
          content: { 'application/json': { schema: resolver(ListChatSessionsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_chat_sessions',
        description:
          "List chat sessions in a workspace (owner-scoped — returns only the authenticated user's " +
          'sessions in that workspace; excludes soft-deleted and archived by default). Read-only.',
      },
    }),
    validator('query', ListChatSessionsQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const query = c.req.valid('query')
      const sessions = listChatSessionsForWorkspace(c.var.db, {
        workspaceId: c.var.workspace!.id,
        ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      })
      return c.json(sessions)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/search — FTS5 full-text search (workspace-scoped)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/search',
    describeRoute({
      tags: ['chat'],
      summary: 'Full-text search across chat messages in the workspace.',
      'x-sdk-name': 'chat.searchSessions',
      responses: {
        200: {
          description: 'Array of ChatMessageSearchResult.',
          content: { 'application/json': { schema: resolver(SearchChatSessionsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      // No x-mcp — the tool (`search_chat_messages`) moved to the user-scoped
      // cross-session route (`sessions/index.ts`, 2026-08-10); this stays the
      // UI's workspace-filtered search.
    }),
    validator('query', SearchChatSessionsQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const query = c.req.valid('query')
      const results = searchChatSessions(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        query: query.query,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      })
      return c.json(results)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /continuing — resolve the workspace's continuing primary conversation
  // (Slice 2; read-only — nulls until the first continue-mode turn creates it).
  // Wire keys keep the source names (rootSessionId) — the root→primary rename
  // is package-side only.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/continuing',
    describeRoute({
      tags: ['chat'],
      summary:
        "Resolve the workspace's continuing root conversation (read-only; nulls until the first continue-mode turn).",
      'x-sdk-name': 'chat.getContinuing',
      responses: {
        200: {
          description: '{ rootSessionId, currentSdkSessionId } — nulls when no root exists yet.',
          content: {
            'application/json': { schema: resolver(ContinuingConversationResponseSchema) },
          },
        },
        404: { description: 'Workspace not found.' },
      },
      // No x-mcp — a UI landing helper, not an agent tool surface.
    }),
    ...workspaceScoped,
    async (c) => {
      const primary = findPrimaryConversation(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      return c.json({
        rootSessionId: primary?.id ?? null,
        currentSdkSessionId: primary?.currentSdkSessionId ?? null,
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /sessions/turn — start (or resume) a chat turn; SSE stream
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/sessions/turn',
    describeRoute({
      tags: ['chat'],
      summary: 'Start (or resume) a chat turn; streams normalized chat-turn events via SSE.',
      'x-sdk-name': 'chat.startTurn',
      responses: {
        200: { description: 'SSE stream of ChatTurnEvent.' },
        404: { description: 'Workspace not found.' },
      },
      // No x-mcp — SSE streaming is not a tool surface in Phase 1.
    }),
    validator('json', StartChatTurnRequestSchema),
    ...workspaceScoped,
    async (c) => streamChatTurn(c, c.req.valid('json')),
  )
  // ──────────────────────────────────────────────────────────────────
  // Session-scoped routes — triple-check user + workspace + chatSession
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId',
    describeRoute({
      tags: ['chat'],
      summary:
        "Get a single chat session's full detail (messages + tool calls grouped by parent message).",
      'x-sdk-name': 'chat.getSession',
      responses: {
        200: {
          description: 'ChatSessionDetail.',
          content: { 'application/json': { schema: resolver(ChatSessionDetailResponseSchema) } },
        },
        404: { description: "Session not found or not in this user's workspace." },
      },
      // No x-mcp — the tool (`get_chat_session`) moved to the user-scoped
      // cross-session route (`sessions/index.ts`, 2026-08-10); this stays the
      // UI's workspace session-detail read.
    }),
    ...sessionScoped,
    async (c) => {
      const detail = getChatSessionDetail(c.var.db, c.var.chatSession!.id)
      // Same serve-time enrichment as root.getSession (one content contract for
      // both detail reads): a delegation-traced row gains the task label so the
      // workspace thread's Watch chip names the actual work too, and a dispatch
      // tool call gains its delegation outcome (the settled-history door).
      return c.json({
        ...detail,
        messages: attachDeliveredRunStats(
          c.var.db,
          attachDelegationTaskLabels(c.var.db, detail.messages),
        ),
        toolCallsByMessageId: attachDelegationToolOutcomes(
          c.var.db,
          detail.toolCallsByMessageId,
        ),
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId/images/:filename — serve a persisted attachment
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId/images/:filename',
    describeRoute({
      tags: ['chat'],
      summary: 'Serve a persisted attached image for re-display (owner-scoped).',
      'x-sdk-name': 'chat.getSessionImage',
      responses: {
        200: { description: 'The image bytes.' },
        400: { description: 'Invalid filename.' },
        404: { description: 'Session or image not found.' },
      },
      // No x-mcp — binary asset, not a tool surface.
    }),
    ...sessionScoped,
    async (c) => {
      const filename = c.req.param('filename')
      const bytes = await readAttachedImageBytes({
        workspacePath: c.var.workspace!.path,
        sessionId: c.var.chatSession!.id,
        filename,
      })
      // Copy into a plain ArrayBuffer-backed Uint8Array — Hono's body type
      // rejects Node's Buffer (its backing buffer is ArrayBufferLike).
      // nosniff: never let the browser MIME-sniff user-uploaded bytes.
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': imageContentType(filename),
        'X-Content-Type-Options': 'nosniff',
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId/context — the /context breakdown (markdown)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId/context',
    describeRoute({
      tags: ['chat'],
      summary:
        "Read the session's context-window breakdown (the runtime's /context report) as markdown.",
      'x-sdk-name': 'chat.getSessionContext',
      responses: {
        200: {
          description: '{ report: string | null } — raw /context markdown, null if unavailable.',
          content: {
            'application/json': { schema: resolver(SessionContextReportResponseSchema) },
          },
        },
        404: { description: 'Session not found.' },
      },
      // No x-mcp — a UI helper; the agent has its own native /context.
    }),
    ...sessionScoped,
    async (c) => {
      const report = await fetchSessionContextReport(c)
      return c.json({ report })
    },
  )
  .patch(
    '/sessions/:sessionId',
    describeRoute({
      tags: ['chat'],
      summary: 'Rename a chat session.',
      'x-sdk-name': 'chat.renameSession',
      responses: {
        200: {
          description: 'Updated ChatSession.',
          content: { 'application/json': { schema: resolver(ChatSessionSchema) } },
        },
        400: { description: 'Invalid title.' },
        404: { description: 'Session not found.' },
      },
      // No x-mcp — mutating; deferred to Phase 1.5 per D26.
    }),
    validator('json', RenameChatSessionRequestSchema),
    ...sessionScoped,
    async (c) => {
      const { title } = c.req.valid('json')
      const updated = renameChatSession(c.var.db, c.var.chatSession!.id, title)
      return c.json(updated)
    },
  )
  .post(
    '/sessions/:sessionId/archive',
    describeRoute({
      tags: ['chat'],
      summary: 'Archive a chat session (hide from default list).',
      'x-sdk-name': 'chat.archiveSession',
      responses: {
        200: {
          description: 'Updated ChatSession.',
          content: { 'application/json': { schema: resolver(ChatSessionSchema) } },
        },
        404: { description: 'Session not found.' },
      },
    }),
    ...sessionScoped,
    async (c) => {
      const updated = archiveChatSession(c.var.db, c.var.chatSession!.id)
      return c.json(updated)
    },
  )
  .post(
    '/sessions/:sessionId/unarchive',
    describeRoute({
      tags: ['chat'],
      summary: 'Unarchive a chat session.',
      'x-sdk-name': 'chat.unarchiveSession',
      responses: {
        200: {
          description: 'Updated ChatSession.',
          content: { 'application/json': { schema: resolver(ChatSessionSchema) } },
        },
        404: { description: 'Session not found.' },
      },
    }),
    ...sessionScoped,
    async (c) => {
      const updated = unarchiveChatSession(c.var.db, c.var.chatSession!.id)
      return c.json(updated)
    },
  )
  .post(
    '/sessions/:sessionId/interrupt',
    describeRoute({
      tags: ['chat'],
      summary: 'Interrupt an active chat session.',
      'x-sdk-name': 'chat.interruptSession',
      responses: {
        204: { description: 'Interrupted.' },
        404: { description: 'Session not found.' },
      },
    }),
    ...sessionScoped,
    async (c) => {
      await interruptChatSession(
        c.var.chatSession!.providerId as AiAgentProviderId,
        c.var.chatSession!.id,
      )
      return c.body(null, 204)
    },
  )
  .delete(
    '/sessions/:sessionId',
    describeRoute({
      tags: ['chat'],
      summary: 'Soft-delete a chat session (sets deletedAt; purge job hard-deletes after 30 days).',
      'x-sdk-name': 'chat.deleteSession',
      responses: {
        204: { description: 'Soft-deleted.' },
        404: { description: 'Session not found.' },
      },
    }),
    ...sessionScoped,
    async (c) => {
      softDeleteChatSession(c.var.db, c.var.chatSession!.id)
      return c.body(null, 204)
    },
  )

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

function imageContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
