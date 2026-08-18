// The live channel's WebSocket door (`GET /api/live`) — the app-level adapter
// between the socket and `LiveChannelHub`. Mounted on the GATEWAY app (the one
// `serve()` runs) rather than the api app: `@hono/node-server`'s upgrade
// completes through the request's own env, which a fetch re-dispatch into the
// inner app cannot carry. Thin by design: resolve the user, hand the socket to
// the hub, forward messages/close, JSON-encode outbound frames. Ownership of
// session/trace channels is answered here from the DB (`authorizeChannel`), so
// the hub never sees a row.
//
// Backpressure: a socket whose outbound buffer passes MAX_BUFFERED_BYTES is
// closed (that window reconnects and reseeds) — a stalled webview must never
// pin memory for the process.

import { upgradeWebSocket } from '@hono/node-server'
import type { WSContext } from 'hono/ws'
import type { MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { Database } from '@vynel/db'
import { findDelegationJobByPartialSessionId } from '@vynel/orchestration'
import type { ParsedLiveChannelKey } from '@vynel/contracts/chat/live-channel'
import type {
  LiveChannelConnection,
  LiveChannelHub,
  LiveChannelOutboundFrame,
} from '@vynel/session/runtime'

const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const CLOSE_CODE_BACKPRESSURE = 4003

export interface LiveChannelRouteDeps {
  hub: LiveChannelHub
  /** Phase 1: the single local user. Phase 2 swaps in the authenticated user
   *  (the `userScoped` seam's twin for a socket). */
  resolveUserId: () => string
  logger: Logger
}

/** The ownership answer the hub asks per session/trace subscribe — the same
 *  reads the SSE observe routes gate on (unknown and not-owned alike = no). */
export function buildLiveChannelAuthorizer(
  db: Database,
): (userId: string, channel: ParsedLiveChannelKey) => boolean {
  return (userId, channel) => {
    switch (channel.kind) {
      case 'activity':
        return true
      case 'session': {
        const session = findChatSessionById(db, channel.sessionId)
        return session !== null && session.userId === userId
      }
      case 'trace': {
        const job = findDelegationJobByPartialSessionId(db, channel.partialSessionId)
        return job !== null && job.userId === userId
      }
      case 'voice':
        // The daemon is this machine's (Phase 1: one local user); the relay
        // itself is the gate — no relay, no channel.
        return true
    }
  }
}

interface RawSocketLike {
  bufferedAmount?: number
}

export function createLiveChannelUpgradeHandler(deps: LiveChannelRouteDeps): MiddlewareHandler {
  return upgradeWebSocket(
    () => {
      const userId = deps.resolveUserId()
      let connection: LiveChannelConnection | null = null
      return {
        onOpen(_event, ws: WSContext<unknown>) {
          connection = deps.hub.connect({
            userId,
            transport: {
              send: (frame: LiveChannelOutboundFrame) => {
                const raw = ws.raw as RawSocketLike | undefined
                if ((raw?.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
                  ws.close(CLOSE_CODE_BACKPRESSURE, 'client not reading')
                  throw new Error('live-channel: outbound buffer over limit')
                }
                ws.send(JSON.stringify(frame))
              },
              close: (code, reason) => ws.close(code, reason),
            },
          })
        },
        onMessage(event) {
          connection?.handleMessage(event.data)
        },
        onClose() {
          connection?.close()
          connection = null
        },
        onError(event) {
          // Node has no global ErrorEvent — the adapter's polyfill carries the
          // thrown error under `error` (its `message` is empty).
          const cause = (event as { error?: unknown }).error
          deps.logger.warn(
            { error: cause instanceof Error ? cause.message : String(cause ?? event.type) },
            'live-channel: socket error',
          )
          connection?.close()
          connection = null
        },
      }
    },
    {
      onError: (error) => {
        deps.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'live-channel: handler threw',
        )
      },
    },
  )
}
