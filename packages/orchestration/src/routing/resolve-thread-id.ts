// The ONE home for the chain-key rule, shared by all three enqueue ops.
//
// `threadId` answers "one task and everything it caused". `partialSessionId`
// answers "one hop" — a fresh key per enqueue, which is what makes each hop
// independently watchable and is deliberately kept. The two coexist: the hop
// key is the inner id, the thread is the envelope.
//
// THE RULE: a continuing hop inherits the thread it was given; a hop that
// starts a chain becomes its own thread, by taking its own `partialSessionId`
// as the thread id.
//
// Why the self-seed rather than a separate UUID: it makes a first hop's
// threadId equal its partialSessionId, so a legacy row (threadId NULL, written
// before this column existed) reads identically to a modern chain-starting row
// — every pre-existing hop simply IS its own thread, which is exactly what it
// was. That is what lets the migration be a pure additive ALTER with no
// backfill, and `resolveThreadIdOf` below reads a NULL row the same way.

import type { DelegationJob } from '../repositories/index.js'

export function resolveThreadId(input: {
  /** The thread this hop continues — absent when it starts one. */
  inheritedThreadId?: string
  /** This hop's own correlation key, used as the seed when starting a chain. */
  partialSessionId: string
}): string {
  const inherited = input.inheritedThreadId?.trim()
  return inherited !== undefined && inherited !== '' ? inherited : input.partialSessionId
}

/** A row's effective thread — its stored `threadId`, or its own hop key when the
 *  column is NULL (a legacy row, or one written before it joined a chain). Read
 *  callers use this instead of the raw column so NULL never leaks into a query. */
export function resolveThreadIdOf(job: DelegationJob): string | null {
  const stored = job.threadId?.trim()
  if (stored !== undefined && stored !== '') return stored
  return job.partialSessionId
}
