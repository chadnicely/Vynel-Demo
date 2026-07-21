// The `/activity` surface — the per-user session-activity SSE feed.
//
//   GET /stream -> subscribe to turn narration (SSE): the in-flight snapshot
//                  replays as `turn-started` frames, then live events follow —
//                  turn lifecycle (started / updated / ended) plus per-tool
//                  steps and approval bells (the contracts vocabulary).
//
// This is the UI's ONLY server push for turns it didn't start itself — a
// Telegram message's background root turn, another tab's turn, a schedule
// fire. Listeners react by enabling their session-detail poll (rows persist
// per chunk, so polled text is near-live) and invalidating on turn end; the
// token stream stays with the turn's own SSE response. Not a tool surface —
// no x-mcp.

import { streamSSE } from 'hono/streaming'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'

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
