// The internal side-channel carrying a turn's OWN SESSION IDENTITY — the chat
// session its MCP tool calls belong to. `set_session_status` sets the status
// light of exactly one session (and `set_task_steps` anchors steps to the
// turn's session), so the id must be the turn's real one.
//
// Why a header (the report-caller/report-requester shape, verbatim): the
// session is AMBIENT turn context the model never sees. A model-visible field
// could name ANOTHER session and quietly rewrite its dock; server-stamped per
// turn, it cannot lie. Internal + never part of the OpenAPI contract. Absent =
// the turn has no watching session (schedule fires, delegation ticks) and the
// tool 400s honestly.
//
// Why a MUTABLE carrier rather than a fixed value: a FRESH conversation has no
// session id when the turn's MCP servers are composed — the id arrives with
// `session-created` / `user-message-persisted`, which is also where
// `mentionPlan.onSessionResolved` is already called from. The wrapper reads the
// CURRENT value at request time, so a resolve after composition still reaches
// every later tool call. Ordering is safe: `user-message-persisted` is EVERY
// turn's first event (see `session-turn-channel.ts`) and it precedes the
// model's first tool call by a full network round trip.

import type { Database } from '@vynel/db'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { HonoAppRequestFn } from '../factory.js'

export const TURN_SESSION_HEADER = 'x-vynel-turn-session'

/** Parse the identity at the route boundary — defensively (absent/blank = no
 *  session; the value is a chat session id, ownership-checked by the route). */
export function parseTurnSessionHeader(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined || headerValue.trim() === '') return undefined
  return headerValue
}

/** The ambient turn-session header, OWNERSHIP-CHECKED before it becomes a
 *  durable loose ref (tasks' `assignedSessionId` / steps' `sessionId`, the
 *  journal's attribution). An invalid or foreign value is treated as ABSENT,
 *  not an error — a background turn without a session stays legal; the tool
 *  simply records no attribution. */
export function resolveOwnedTurnSessionId(
  db: Database,
  userId: string,
  headerValue: string | undefined,
): string | undefined {
  const turnSessionId = parseTurnSessionHeader(headerValue)
  if (turnSessionId === undefined) return undefined
  const session = findChatSessionById(db, turnSessionId)
  if (session === null || session.userId !== userId) return undefined
  return session.id
}

/**
 * Whether the tool call comes from the GLOBAL ASSISTANT's own turn — the
 * identity-aware exception to the cross-session scope wall: the brain's
 * private thread never surfaces to another identity, but the brain may read
 * ITSELF (the continuity carry points a fresh segment at its own earlier
 * chain). Resolved from the server-stamped header only — a spoofed or foreign
 * id is not the brain, and no header (an external MCP client, a schedule fire)
 * keeps the wall up.
 */
export function isTurnFromGlobalRoot(
  db: Database,
  userId: string,
  turnSessionId: string | undefined,
): boolean {
  if (turnSessionId === undefined) return false
  const session = findChatSessionById(db, turnSessionId)
  // The VOICE thread is the global root's spoken twin (voice-session arc) —
  // one assistant, two areas: both get the self-read lift (a fresh voice swap
  // segment must read its own predecessor per its duty book), and each may
  // read the other (Kafi's model — voice communicates with global as one
  // feature). Every other identity stays behind the wall.
  return (
    session !== null &&
    session.userId === userId &&
    (session.scope === 'global' || session.scope === 'voice')
  )
}
export interface TurnSessionCarrier {
  /** Wrap the in-process dispatcher so every request this turn's MCP tools make
   *  carries whatever session identity is known AT THAT MOMENT. */
  wrapAppRequest(appRequest: HonoAppRequestFn): HonoAppRequestFn
  /** The turn resolved its session — stamp it from here on. */
  resolve(sessionId: string): void
  /** Whatever id is known RIGHT NOW — undefined before the turn resolves one.
   *  The read half of the same carrier: a feature tool that RECORDS the
   *  conversation (an ask row) reads this at call time instead of taking a
   *  build-time value that a fresh conversation cannot have yet. */
  current(): string | undefined
}

/** One carrier per turn. Seed it with the session being resumed when the
 *  caller already knows it; a fresh conversation seeds nothing and resolves
 *  from the stream. */
export function createTurnSessionCarrier(seedSessionId?: string): TurnSessionCarrier {
  let sessionId = seedSessionId
  return {
    wrapAppRequest(appRequest) {
      return (input, init) => {
        if (sessionId === undefined) return appRequest(input, init)
        const headers = new Headers(init?.headers)
        headers.set(TURN_SESSION_HEADER, sessionId)
        return appRequest(input, { ...init, headers })
      }
    },
    resolve(resolvedSessionId) {
      if (resolvedSessionId !== '') sessionId = resolvedSessionId
    },
    current() {
      return sessionId
    },
  }
}
