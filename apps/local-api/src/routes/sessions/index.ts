// The `sessions` HTTP surface — the unified cross-scope session list
// (session-library Slice ③) + spawned-session creation (Slice ④), mounted at
// `/sessions` (USER-scoped, no workspace prefix) from `apps/local-api/src/app.ts`:
//
//   GET  /overview -> the Sessions panel's list AND the root's `list_sessions`
//                     tool (x-mcp, rootSurface) — ONE op, one truth: the user
//                     and the planning model read the SAME context numbers
//   POST /spawned  -> `create_session` (x-mcp, rootSurface) — the root spawns
//                     a normal continuing session as a tool
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
import { sessionChannelKey } from '@vynel/session/runtime'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ensureGlobalRootWorkspaceDir } from '../../sessions/global-root-workspace.js'
import {
  SessionsOverviewResponseSchema,
  CreateSpawnedSessionRequestSchema,
  CreateSpawnedSessionResponseSchema,
} from './schemas.js'

const SessionStreamParamSchema = z.object({ sessionId: z.string().min(1) })

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
      'x-mcp': {
        exposed: true,
        name: 'list_sessions',
        rootSurface: true,
        description:
          "List every session — yours (scope 'spawned' = sessions you created), the user's " +
          'workspaces, and the assistant thread — with per-session context usage: contextTokens ' +
          'used of contextWindow. Check these numbers BEFORE choosing where to send work: a ' +
          'session near its window is a poor target; create a new one instead. Each entry’s ' +
          'sessionId is the handle send_task_to_session accepts. Read-only.',
      },
    }),
    ...userScoped,
    async (c) => {
      return c.json(getSessionsOverview(c.var.db, { userId: c.var.user.id }))
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
      },
      // Uncarded (mutatingApproved without a card): the root's own surface
      // never cards, and Chad's "Claude manages freely" Apps precedent applies
      // to session management (recorded in the module notes).
      'x-mcp': {
        exposed: true,
        name: 'create_session',
        mutatingApproved: true,
        rootSurface: true,
        description:
          'Create a NEW session: a normal continuing conversation with its own context, primed ' +
          'with the purpose you give it. Use it to hand off big or parallel work and keep your ' +
          'own context free — prefer send_task_to_workspace when the task belongs to a specific ' +
          "workspace's ongoing context, and a new session for standalone or cross-cutting work. " +
          'Check list_sessions first: reuse an existing suitable session instead of creating ' +
          'duplicates. Returns { sessionId, name } — pass sessionId to send_task_to_session. ' +
          'The session appears in the user’s Sessions panel immediately.',
      },
    }),
    validator('json', CreateSpawnedSessionRequestSchema),
    ...userScoped,
    async (c) => {
      const { name, purpose } = c.req.valid('json')
      // V1 ground (locked fork 1): spawned sessions inherit the GLOBAL root's
      // scope — its hidden user-data cwd, no workspace.
      const created = await createSpawnedSession(c.var.db, c.var.aiProvider, {
        userId: c.var.user.id,
        name,
        purpose,
        workspacePath: ensureGlobalRootWorkspaceDir(),
        logger: c.var.logger,
      })
      return c.json({ status: 'created' as const, sessionId: created.sessionId, name: created.name })
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
    validator('param', SessionStreamParamSchema),
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
          stream.onAbort(finish)
        })
      })
    },
  )
