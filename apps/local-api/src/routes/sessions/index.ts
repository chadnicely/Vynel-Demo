// The `sessions` HTTP surface — the unified cross-scope session list
// (session-library Slice ③) + spawned-session creation (Slice ④), mounted at
// `/sessions` (USER-scoped, no workspace prefix) from `apps/local-api/src/app.ts`:
//
//   GET  /overview -> the Sessions panel's list AND the root's `list_sessions`
//                     tool (x-mcp, rootSurface) — ONE op, one truth: the user
//                     and the planning model read the SAME context numbers
//   POST /spawned  -> `create_session` (x-mcp, rootSurface) — the root spawns
//                     a normal continuing session as a tool
//   POST /:sessionId/turn -> the user chats DIRECTLY into a spawned session
//                     (sessions-surface Slice ③a; SSE, no x-mcp)
//   GET  /:sessionId/settings   -> the per-session composer settings (no x-mcp)
//   PATCH /:sessionId/settings  -> partial settings update (no x-mcp)
//
// Thin by design: parse → call the session-tier op → return. The overview op
// returns the wire shape directly (ISO dates), so the panel and the tool read
// identical data.

import { resolver, validator } from 'hono-openapi/zod'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { NotFoundError } from '@vynel/errors'
import { getSessionsOverview } from '@vynel/session/overview'
import { createSpawnedSession } from '@vynel/session/spawned'
import { getWorkspaceById } from '@vynel/workspaces'
import { sessionChannelKey } from '@vynel/session/runtime'
import { getChatSessionDetail, searchChatSessions, updateChatSessionSettings } from '@vynel/chat'
import { enrichChatSessionDetail } from '../../sessions/enrich-chat-session-detail.js'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ensureGlobalRootWorkspaceDir } from '../../sessions/global-root-workspace.js'
import { streamSpawnedSessionTurn } from '../../streams/session-turn.js'
import {
  SessionsOverviewResponseSchema,
  CreateSpawnedSessionRequestSchema,
  CreateSpawnedSessionResponseSchema,
  StartSessionTurnRequestSchema,
  SearchSessionMessagesQuerySchema,
  SearchChatSessionsResponseSchema,
  ChatSessionDetailResponseSchema,
  ChatSessionSettingsSchema,
  UpdateChatSessionSettingsRequestSchema,
} from './schemas.js'

const SessionIdParamSchema = z.object({ sessionId: z.string().min(1) })

// The settings routes' response shape — the four settings columns off the row,
// nothing else (the full row stays on the detail/list reads).
function toSessionSettings(session: {
  sessionMode: string | null
  selectedModel: string | null
  thinkingEffort: string | null
  autoBuildout: boolean | null
}) {
  return {
    sessionMode: session.sessionMode,
    selectedModel: session.selectedModel,
    thinkingEffort: session.thinkingEffort,
    autoBuildout: session.autoBuildout,
  }
}

export const sessionsApp = factory
  .createApp()
  .get(
    '/overview',
    describeRoute({
      tags: ['sessions'],
      summary:
        'List every session across scopes — continuity chains folded into single entries, newest first.',
      'x-sdk-name': 'sessions.overview',
      responses: {
        200: {
          description:
            'Array of session entries (chain segments nested), sorted by last use.',
          content: { 'application/json': { schema: resolver(SessionsOverviewResponseSchema) } },
        },
      },
      // Slice ④: the SAME op the Sessions panel reads, re-exposed as the
      // root's planning tool — one truth for the user and the model.
      // Slice ④b: also rides WORKSPACE INTERACTIVE chat streams (the
      // workspaceInteractiveSurface flag → generatedWorkspaceInteractiveMcpTools,
      // composed only by the interactive stream's descriptor).
      'x-mcp': {
        exposed: true,
        name: 'list_sessions',
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          "List every session — yours (scope 'spawned' = sessions you created), the user's " +
          'workspaces, and the assistant thread — with per-session context usage: contextTokens ' +
          'used of contextWindow. Check these numbers BEFORE choosing where to send work: a ' +
          'session near its window is a poor target; create a new one instead. Each entry’s ' +
          'sessionId is what send_message’s "session:<sessionId>" destination accepts. Read-only.',
      },
    }),
    ...userScoped,
    async (c) => {
      return c.json(getSessionsOverview(c.var.db, { userId: c.var.user.id }))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /search — search_chat_messages: FTS across EVERY owned session
  // (2026-08-10). User-scoped with an optional workspace filter — the one
  // search tool every tier carries. The global root's own thread is walled
  // off at the repo layer (scope != 'global').
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/search',
    describeRoute({
      tags: ['sessions'],
      summary: 'Full-text search across all the user’s session messages (optional workspace filter).',
      'x-sdk-name': 'sessions.searchMessages',
      responses: {
        200: {
          description: 'Array of ChatMessageSearchResult (message-level hits, best rank first).',
          content: { 'application/json': { schema: resolver(SearchChatSessionsResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'search_chat_messages',
        rootSurface: true,
        workspaceSurface: true,
        // Omitting workspaceId means "search the whole system" — never let the
        // generator stamp the turn's own workspace over that.
        ambientWorkspace: false,
        description:
          'Full-text search across ALL of the user’s session conversations — workspace chats and ' +
          'spawned/agent sessions alike (the global assistant thread is excluded). Pass ' +
          'workspaceId to restrict to one workspace; omit it to search the entire system. ' +
          'Returns message-level hits with <mark> snippets and each hit’s sessionId — pass that ' +
          'to get_chat_session to read the full conversation. Read-only.',
      },
    }),
    validator('query', SearchSessionMessagesQuerySchema),
    ...userScoped,
    async (c) => {
      const query = c.req.valid('query')
      const results = searchChatSessions(c.var.db, {
        userId: c.var.user.id,
        query: query.query,
        ...(query.workspaceId !== undefined ? { workspaceId: query.workspaceId } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      })
      return c.json(results)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /:sessionId/messages — get_chat_session: one owned session's full
  // conversation (2026-08-10). Owner-gated, any grounding — EXCEPT the global
  // root's own thread (same 404 as unknown/not-owned; no enumeration leak).
  // The UI's scope-routed reads (chat.getSession / root.getSession) stay
  // untouched — this is the tool surface's door.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/:sessionId/messages',
    describeRoute({
      tags: ['sessions'],
      summary: "Get one owned session's full conversation (messages + tool calls).",
      'x-sdk-name': 'sessions.getMessages',
      responses: {
        200: {
          description: '{ session, messages, toolCallsByMessageId } — the full session detail.',
          content: { 'application/json': { schema: resolver(ChatSessionDetailResponseSchema) } },
        },
        404: { description: 'Unknown session, not owned, or the global assistant thread.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_chat_session',
        rootSurface: true,
        workspaceSurface: true,
        description:
          'Read one session’s full conversation (messages + tool calls) by sessionId — works for ' +
          'any of the user’s sessions across workspaces, including spawned and agent sessions ' +
          '(the global assistant thread is excluded). Get sessionIds from list_sessions or ' +
          'search_chat_messages. Transcripts can be long — prefer search_chat_messages when you ' +
          'only need to find something. Read-only.',
      },
    }),
    validator('param', SessionIdParamSchema),
    ...userScoped,
    async (c) => {
      const { sessionId } = c.req.valid('param')
      // `forbiddenScopes: ['global']` is the wall: the brain's private
      // conversation never leaves through the tool surface — same 404 as
      // unknown/not-owned (Chad, 2026-08-10).
      const detail = getChatSessionDetail(c.var.db, sessionId, {
        ownerUserId: c.var.user.id,
        forbiddenScopes: ['global'],
      })
      return c.json(enrichChatSessionDetail(c.var.db, detail))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /spawned — create_session: spawn a named, primed continuing session
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/spawned',
    describeRoute({
      tags: ['sessions'],
      summary: 'Create a spawned session — a named, purpose-primed continuing session.',
      'x-sdk-name': 'sessions.createSpawned',
      responses: {
        200: {
          description: "{ status: 'created', sessionId, name }",
          content: {
            'application/json': { schema: resolver(CreateSpawnedSessionResponseSchema) },
          },
        },
        404: { description: 'workspaceId given but the workspace is unknown or not owned.' },
      },
      // Uncarded (mutatingApproved without a card): the root's own surface
      // never cards, and Chad's "Claude manages freely" Apps precedent applies
      // to session management (recorded in the module notes).
      // Slice ④b: also rides WORKSPACE INTERACTIVE chat streams (see list_sessions).
      'x-mcp': {
        exposed: true,
        name: 'create_session',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          'Create a NEW session: a normal continuing conversation with its own context, primed ' +
          'with the purpose you give it. Use it to hand off big or parallel work and keep your ' +
          'own context free — prefer send_message to "workspace:<id>" when the task belongs to ' +
          "a specific workspace's ongoing context, and a new session for standalone or " +
          'cross-cutting work. Check list_sessions first: reuse an existing suitable session ' +
          'instead of creating duplicates. Returns { sessionId, name } — address it with ' +
          'send_message to "session:<sessionId>". The session appears in the user’s Sessions ' +
          'panel immediately.',
      },
    }),
    validator('json', CreateSpawnedSessionRequestSchema),
    ...userScoped,
    async (c) => {
      const { name, purpose, workspaceId } = c.req.valid('json')
      // Ground = the creator's (locked fork 1, extended by Slice ④b): a
      // workspace-origin call grounds the session in ITS workspace
      // (ownership-checked — unknown and not-owned both 404); absent →
      // the global root's hidden user-data cwd, no workspace.
      const workspace =
        workspaceId !== undefined
          ? await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
          : null
      const created = await createSpawnedSession(c.var.db, c.var.aiProvider, {
        userId: c.var.user.id,
        name,
        purpose,
        workspacePath: workspace === null ? ensureGlobalRootWorkspaceDir() : workspace.path,
        ...(workspace !== null ? { workspaceId: workspace.id } : {}),
        logger: c.var.logger,
      })
      return c.json({ status: 'created' as const, sessionId: created.sessionId, name: created.name })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /:sessionId/settings + PATCH /:sessionId/settings — the per-session
  // composer settings (mode / model / effort / auto-buildout). USER-scoped on
  // purpose: one settings surface for every scope the composer hosts — global
  // thread segments (workspaceId null), workspace sessions, spawned sessions —
  // where the workspace-prefixed chat surface can't reach the global rows.
  // Ownership-gated like /:sessionId/stream (unknown and not-owned both 404);
  // deliberately NO global-scope wall — this is the UI's own surface, not a
  // tool door (no x-mcp).
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/:sessionId/settings',
    describeRoute({
      tags: ['sessions'],
      summary: "Read a session's composer settings (null fields = never set).",
      'x-sdk-name': 'sessions.getSettings',
      responses: {
        200: {
          description:
            '{ sessionMode, selectedModel, thinkingEffort, autoBuildout } — each null when the user never set it on this session.',
          content: { 'application/json': { schema: resolver(ChatSessionSettingsSchema) } },
        },
        404: { description: 'Unknown session, or not owned.' },
      },
      // No x-mcp — the composer's own preference surface, not a tool.
    }),
    validator('param', SessionIdParamSchema),
    ...userScoped,
    async (c) => {
      const { sessionId } = c.req.valid('param')
      const session = findChatSessionById(c.var.db, sessionId)
      if (session === null || session.userId !== c.var.user.id) {
        throw new NotFoundError('session', sessionId)
      }
      return c.json(toSessionSettings(session))
    },
  )
  .patch(
    '/:sessionId/settings',
    describeRoute({
      tags: ['sessions'],
      summary: "Update a session's composer settings (partial — only provided fields change).",
      'x-sdk-name': 'sessions.updateSettings',
      responses: {
        200: {
          description: 'The updated settings.',
          content: { 'application/json': { schema: resolver(ChatSessionSettingsSchema) } },
        },
        404: { description: 'Unknown session, or not owned.' },
      },
      // No x-mcp — mutating a user preference; the model steers its own turns
      // through the turn request, never by flipping the user's chips.
    }),
    validator('param', SessionIdParamSchema),
    validator('json', UpdateChatSessionSettingsRequestSchema),
    ...userScoped,
    async (c) => {
      const { sessionId } = c.req.valid('param')
      const session = findChatSessionById(c.var.db, sessionId)
      if (session === null || session.userId !== c.var.user.id) {
        throw new NotFoundError('session', sessionId)
      }
      const updated = updateChatSessionSettings(c.var.db, sessionId, c.req.valid('json'))
      return c.json(toSessionSettings(updated))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /:sessionId/stream — observe ANY of the user's sessions live (Watch
  // everywhere). The runners tee every turn's events onto session:<id>; this
  // subscribes. CONTRACT: one attach observes ONE turn — the stream emits
  // `turn-stream-ended` at the first turn end and closes (the trace-route
  // precedent; the panel re-attaches for a new turn). An idle attach waits
  // silently until a turn starts or the client detaches — the activity feed
  // drives the UI's attach lifecycle.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/:sessionId/stream',
    describeRoute({
      tags: ['sessions'],
      summary: "Observe a session's live turn — streams its ChatTurnEvents via SSE.",
      'x-sdk-name': 'sessions.streamSession',
      responses: {
        200: { description: 'SSE stream of the session’s live events; turn-stream-ended per turn.' },
        404: { description: 'Unknown session, or not owned.' },
      },
      // No x-mcp — SSE streaming is not a tool surface.
    }),
    validator('param', SessionIdParamSchema),
    ...userScoped,
    (c) => {
      const { sessionId } = c.req.valid('param')
      // Ownership — unknown and not-owned get the same 404 (no enumeration leak).
      const session = findChatSessionById(c.var.db, sessionId)
      if (session === null || session.userId !== c.var.user.id) {
        throw new NotFoundError('session', sessionId)
      }

      const turnEvents = c.var.turnEvents
      return streamSSE(c, async (stream) => {
        await new Promise<void>((resolve) => {
          let settled = false
          const finish = (): void => {
            if (settled) return
            settled = true
            clearInterval(heartbeatTimer)
            unsubscribe()
            resolve()
          }
          const unsubscribe = turnEvents.subscribe(sessionChannelKey(sessionId), {
            onEvent: (event) => {
              void stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
            },
            onEnd: () => {
              void stream.writeSSE({ event: 'turn-stream-ended', data: '{}' }).finally(finish)
            },
          })
          // Keeps proxies/half-open sockets from silently wedging an idle watch —
          // the activity-feed heartbeat shape; comment frames never reach the fold.
          const heartbeatTimer = setInterval(() => {
            void stream.write(':ping\n\n')
          }, 25_000)
          stream.onAbort(finish)
        })
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /:sessionId/turn — chat DIRECTLY into a spawned session (Slice ③a).
  // :sessionId is the handle list_sessions/create_session hand out (the
  // entry's CURRENT segment id); the turn resumes the chain HEAD with the
  // session's BACKGROUND toolset and FIFO-queues behind a running delegated
  // task on the same session (the three locked decisions — see the stream).
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/:sessionId/turn',
    describeRoute({
      tags: ['sessions'],
      summary: 'Run an interactive user turn on a spawned session — SSE ChatTurnEvents.',
      'x-sdk-name': 'sessions.startTurn',
      responses: {
        200: {
          description:
            'SSE stream of the turn’s ChatTurnEvents; a `turn-queued` sentinel precedes a ' +
            'turn parked behind a running task; `turn-stream-ended` closes the stream.',
        },
        404: { description: 'Unknown session, not owned, or not a spawned session.' },
      },
      // No x-mcp — this is the UI's chat surface, not a tool (the model's door
      // into a session is send_message to "session:<id>").
    }),
    validator('param', SessionIdParamSchema),
    validator('json', StartSessionTurnRequestSchema),
    ...userScoped,
    async (c) => {
      const { sessionId } = c.req.valid('param')
      return streamSpawnedSessionTurn(c, sessionId, c.req.valid('json'))
    },
  )
