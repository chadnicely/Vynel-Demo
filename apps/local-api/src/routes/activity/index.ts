// The `/activity` surface — the per-user session-activity SSE feed.
//
//   GET /stream -> subscribe to turn narration (SSE): the in-flight snapshot
//                  replays as `turn-started` frames, then live events follow —
//                  turn lifecycle (started / updated / ended) plus per-tool
//                  steps and approval bells (the contracts vocabulary).
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
import { resolver } from 'hono-openapi/zod'
import { listRunningSessionTurnsForUser } from '@vynel/session/runtime'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { RunningSessionTurnsResponseSchema } from './schemas.js'

// Keeps proxies from reaping the idle connection between turns; the client's
// frame parser skips `:` comment lines, so pings never reach the event fold.
const HEARTBEAT_MS = 25_000

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
