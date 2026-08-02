// The internal side-channel carrying a turn's OWN SESSION IDENTITY — the chat
// session its MCP tool calls belong to. `set_todos` writes the working-steps
// dock of exactly one session, and the dock is what the user is looking at, so
// the id must be the turn's real one.
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

import type { HonoAppRequestFn } from '../factory.js'

export const TURN_SESSION_HEADER = 'x-vynel-turn-session'

/** Parse the identity at the route boundary — defensively (absent/blank = no
 *  session; the value is a chat session id, ownership-checked by the route). */
export function parseTurnSessionHeader(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined || headerValue.trim() === '') return undefined
  return headerValue
}

export interface TurnSessionCarrier {
  /** Wrap the in-process dispatcher so every request this turn's MCP tools make
   *  carries whatever session identity is known AT THAT MOMENT. */
  wrapAppRequest(appRequest: HonoAppRequestFn): HonoAppRequestFn
  /** The turn resolved its session — stamp it from here on. */
  resolve(sessionId: string): void
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
  }
}
