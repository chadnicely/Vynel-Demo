// `buildSessionTurnRecorder` — the DB-backed implementation of the feed's
// durable-envelope seam (persona-sessions): begin/resolve/end mirror into
// `session_turns` so a refresh or api restart rebuilds the live picture.
// Every write is guarded HERE (the recorder owns its failure handling, per the
// seam's contract): liveness must never die on a bookkeeping write — a failed
// write is logged loud and the feed streams on.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { SessionTurnRecorder } from './session-activity-feed.js'
import {
  insertSessionTurn,
  resolveSessionTurnSession,
  endSessionTurn,
} from '../repositories/index.js'

export function buildSessionTurnRecorder(db: Database, logger: Logger): SessionTurnRecorder {
  return {
    turnStarted: (turn) => {
      try {
        insertSessionTurn(db, {
          id: turn.turnId,
          userId: turn.userId,
          scopeKind: turn.scopeKind,
          workspaceId: turn.workspaceId,
          origin: turn.origin,
          sessionId: turn.sessionId,
          primarySessionId: turn.primarySessionId,
          jobId: turn.jobId,
          threadId: turn.threadId,
          partialSessionId: turn.partialSessionId,
          startedAt: turn.startedAt,
          endedAt: null,
          endedReason: null,
        })
      } catch (err) {
        logger.error({ err, turnId: turn.turnId }, 'session-turn recorder: start write failed')
      }
    },
    turnResolved: (turnId, sessionId) => {
      try {
        resolveSessionTurnSession(db, turnId, sessionId)
      } catch (err) {
        logger.error({ err, turnId }, 'session-turn recorder: resolve write failed')
      }
    },
    turnEnded: (turnId, outcome) => {
      try {
        endSessionTurn(db, turnId, new Date(), outcome)
      } catch (err) {
        logger.error({ err, turnId }, 'session-turn recorder: end write failed')
      }
    },
  }
}
