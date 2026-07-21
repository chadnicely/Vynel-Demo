// The `sessions` HTTP surface — the unified cross-scope session list
// (session-library Slice ③), mounted at `/sessions` (USER-scoped, no
// workspace prefix) from `apps/local-api/src/app.ts`:
//
//   GET /overview -> the Sessions panel's list [no x-mcp yet — Slice ④'s
//                    `list_sessions` tool re-exposes the same op with the
//                    session-library descriptor, not this UI read]
//
// Thin by design: parse → call `getSessionsOverview` (the one home for chain
// folding + fork-B surfacing) → return. The op returns the wire shape
// directly (ISO dates), so the panel and the future tool read identical data.

import { resolver, validator } from 'hono-openapi/zod'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { NotFoundError } from '@vynel/errors'
import { getSessionsOverview } from '@vynel/session/overview'
import { sessionChannelKey } from '@vynel/session/runtime'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { SessionsOverviewResponseSchema } from './schemas.js'

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
    }),
    ...userScoped,
    async (c) => {
      return c.json(getSessionsOverview(c.var.db, { userId: c.var.user.id }))
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
