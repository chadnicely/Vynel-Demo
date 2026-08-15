// The `/activity` surface — the per-user session-activity SSE feed.
//
//   GET /stream -> subscribe to turn narration (SSE): the in-flight snapshot
//                  replays as `turn-started` frames, then live events follow —
//                  turn lifecycle (started / updated / ended) plus per-tool
//                  steps and approval bells (the contracts vocabulary).
//
//   GET /messages -> who spoke to whom inside a short window: the edges the
//                  node screen draws a line for. Polled, not pushed — the line
//                  is short-lived, so a refresh cadence is enough.
//
//   GET /running -> the DURABLE in-flight turns (persona-sessions): the
//                  refresh/restart rebuild seed — what `session_turns` says is
//                  running right now, before the stream's live frames arrive.
//
// This is the UI's ONLY server push for turns it didn't start itself — a
// Telegram message's background root turn, another tab's turn, a schedule
// fire. Listeners react by enabling their session-detail poll (rows persist
// per chunk, so polled text is near-live) and invalidating on turn end; the
// token stream stays with the turn's own SSE response. Not a tool surface —
// no x-mcp.

import { streamSSE } from 'hono/streaming'
import { resolver, validator } from 'hono-openapi/zod'
import { listRunningSessionTurnsForUser } from '@vynel/session/runtime'
import { listRecentMessageEdges } from '@vynel/orchestration'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  RecentMessageEdgesQuerySchema,
  RecentMessageEdgesResponseSchema,
  RunningSessionTurnsResponseSchema,
} from './schemas.js'

// Keeps proxies from reaping the idle connection between turns; the client's
// frame parser skips `:` comment lines, so pings never reach the event fold.
const HEARTBEAT_MS = 25_000

// The arcs fade about a minute after the message; asking for a little more than
// that means a client that just opened still sees one already in flight.
const DEFAULT_MESSAGE_WINDOW_SECONDS = 120

export const activityApp = factory
  .createApp()
  .get(
    '/stream',
    describeRoute({
      tags: ['activity'],
      summary: 'Subscribe to the session-activity feed (SSE turn liveness, snapshot + live).',
      'x-sdk-name': 'activity.stream',
      responses: {
        200: {
          description:
            'SSE stream of SessionActivityEvents (turn lifecycle + tool steps + approval bells). Long-lived; ends only when the client disconnects.',
        },
      },
    }),
    ...userScoped,
    (c) => {
      const activityFeed = c.var.activityFeed
      const userId = c.var.user.id
      return streamSSE(c, async (stream) => {
        await new Promise<void>((resolve) => {
          let settled = false
          const finish = (): void => {
            if (settled) return
            settled = true
            unsubscribe()
            clearInterval(heartbeatTimer)
            resolve()
          }
          const unsubscribe = activityFeed.subscribe(userId, (event) => {
            void stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
          })
          const heartbeatTimer = setInterval(() => {
            void stream.write(':ping\n\n')
          }, HEARTBEAT_MS)
          // The feed never ends server-side — the client disconnect is the exit.
          stream.onAbort(finish)
        })
      })
    },
  )
  .get(
    '/running',
    describeRoute({
      tags: ['activity'],
      summary: 'The durable in-flight turns — the refresh/restart rebuild seed.',
      'x-sdk-name': 'activity.listRunningTurns',
      responses: {
        200: {
          description: 'Every turn session_turns says is running, oldest first.',
          content: {
            'application/json': { schema: resolver(RunningSessionTurnsResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const turns = listRunningSessionTurnsForUser(c.var.db, c.var.user.id).map((turn) => ({
        turnId: turn.id,
        scopeKind: turn.scopeKind,
        workspaceId: turn.workspaceId,
        origin: turn.origin,
        sessionId: turn.sessionId,
        primarySessionId: turn.primarySessionId,
        jobId: turn.jobId,
        threadId: turn.threadId,
        partialSessionId: turn.partialSessionId,
        startedAt: turn.startedAt.toISOString(),
      }))
      return c.json({ turns })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /messages — who spoke to whom, just now (the node screen's arcs).
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/messages',
    describeRoute({
      tags: ['activity'],
      summary: 'Recent session-to-session messages — the arcs the node screen draws.',
      'x-sdk-name': 'activity.listRecentMessages',
      responses: {
        200: {
          description: 'Every message sent inside the window, newest first.',
          content: {
            'application/json': { schema: resolver(RecentMessageEdgesResponseSchema) },
          },
        },
      },
      // No x-mcp — a UI drawing helper, not an agent tool surface.
    }),
    ...userScoped,
    validator('query', RecentMessageEdgesQuerySchema),
    (c) => {
      const { withinSeconds } = c.req.valid('query')
      const since = new Date(Date.now() - (withinSeconds ?? DEFAULT_MESSAGE_WINDOW_SECONDS) * 1000)
      const edges = listRecentMessageEdges(c.var.db, { userId: c.var.user.id, since })
      return c.json({ edges })
    },
  )
