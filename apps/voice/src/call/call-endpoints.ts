import { Hono, type Context } from 'hono'
import type { Logger } from 'pino'
import { CallRegistryError, type CallDescriptor, type CallMode, type StartCallRequest } from './call-registry.js'

// The /calls route group on the daemon's loopback server — the conductor's
// wire. local-api's call tools (C2) relay here exactly like speak-through-
// daemon relays /speak. Parse → call the registry → map typed errors to
// honest statuses; no call logic lives in these routes.

/** What the endpoints need from the registry — consumer-owned so tests fake it. */
export interface CallRoster {
  startCall(request: StartCallRequest): CallDescriptor
  endCall(callId: string): CallDescriptor
  listCalls(): CallDescriptor[]
}

const STATUS_BY_KIND = {
  'not-configured': 400,
  'device-missing': 400,
  'pair-busy': 409,
  'unknown-call': 404,
} as const

export function createCallEndpoints(roster: CallRoster, logger: Logger): Hono {
  return new Hono()
    .post('/', async (c) => {
      const body = (await c.req.json().catch(() => null)) as {
        label?: unknown
        mode?: unknown
        sessionId?: unknown
      } | null
      // sessionId is FUNCTIONAL (it wires the brain), so an invalid one 400s
      // rather than coercing — a typo must not silently start a brainless call.
      if (body?.sessionId !== undefined && (typeof body.sessionId !== 'string' || body.sessionId.trim() === '')) {
        return c.json({ error: 'sessionId must be a non-empty string when given' }, 400)
      }
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : undefined
      // A non-string label coerces to the default deliberately — the label is
      // cosmetic. Mode gates behavior, so an invalid one 400s instead. The cap
      // matches the spawned session NAME cap (120): the label becomes the call
      // session's name, and one limit at the outer boundary beats a truncation
      // that would make the Sessions panel disagree with the call roster.
      const rawLabel = typeof body?.label === 'string' ? body.label.trim() : ''
      if (rawLabel.length > 120) {
        return c.json({ error: 'label must be at most 120 characters' }, 400)
      }
      const label = rawLabel === '' ? 'call' : rawLabel
      if (body?.mode !== undefined && body.mode !== 'notetaker' && body.mode !== 'participant') {
        return c.json({ error: "mode must be 'notetaker' or 'participant'" }, 400)
      }
      const mode: CallMode = body?.mode === 'participant' ? 'participant' : 'notetaker'
      try {
        return c.json(
          roster.startCall({ label, mode, ...(sessionId !== undefined ? { sessionId } : {}) }),
        )
      } catch (error) {
        return respondRegistryError(c, error, logger)
      }
    })
    .get('/', (c) => c.json({ calls: roster.listCalls() }))
    .delete('/:callId', (c) => {
      try {
        return c.json(roster.endCall(c.req.param('callId')))
      } catch (error) {
        return respondRegistryError(c, error, logger)
      }
    })
}

function respondRegistryError(c: Context, error: unknown, logger: Logger): Response {
  if (error instanceof CallRegistryError) {
    return c.json({ error: error.message, kind: error.kind }, STATUS_BY_KIND[error.kind])
  }
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    'call endpoint failed unexpectedly',
  )
  return c.json({ error: 'call operation failed — see the daemon log' }, 500)
}
