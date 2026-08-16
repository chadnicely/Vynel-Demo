import { Hono, type Context } from 'hono'
import type { Logger } from 'pino'
import { CallRegistryError, type CallDescriptor, type CallMode, type StartCallRequest } from './call-registry.js'
import { findCaptureProcessId } from './capture-process-lookup.js'
import { restoreCallMicLevels } from './call-mic-level.js'

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

/** The conductor's voice into a live call — the conversation host implements it. */
export interface CallVoice {
  speakIntoCall(callId: string, text: string): boolean
}

const STATUS_BY_KIND = {
  'not-configured': 400,
  'device-missing': 400,
  'pair-busy': 409,
  'unknown-call': 404,
} as const

export function createCallEndpoints(
  roster: CallRoster,
  voice: CallVoice,
  logger: Logger,
  resolveCaptureProcessId: (imageName: string) => Promise<number | null> = findCaptureProcessId,
  restoreMicLevels: () => Promise<unknown> = () => restoreCallMicLevels(logger),
): Hono {
  return new Hono()
    .post('/:callId/speak', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      // The same bound as the daemon's own /speak surface.
      if (text === '' || text.length > 2000) {
        return c.json({ error: 'text must be a non-empty string of at most 2000 characters' }, 400)
      }
      if (!voice.speakIntoCall(c.req.param('callId'), text)) {
        return c.json({ error: 'no live call with a conversation under that id' }, 404)
      }
      return c.json({ ok: true })
    })
    .post('/', async (c) => {
      const body = (await c.req.json().catch(() => null)) as {
        label?: unknown
        mode?: unknown
        sessionId?: unknown
        capturePid?: unknown
        captureProcessName?: unknown
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
      // capturePid targets the call app for a loopback-ears pair (the Windows
      // driver path). FUNCTIONAL — a bad value 400s rather than coercing, so a
      // typo never silently makes the call deaf.
      if (
        body?.capturePid !== undefined &&
        (typeof body.capturePid !== 'number' || !Number.isInteger(body.capturePid) || body.capturePid <= 0)
      ) {
        return c.json({ error: 'capturePid must be a positive integer when given' }, 400)
      }
      let capturePid = typeof body?.capturePid === 'number' ? body.capturePid : undefined
      // captureProcessName is the conductor-friendly alternative: it knows the
      // app ("chrome"), never a pid. FUNCTIONAL like capturePid — bad shapes
      // 400. Both at once 400s too: a silent precedence would hide a caller
      // bug behind whichever ears happened to win.
      if (
        body?.captureProcessName !== undefined &&
        (typeof body.captureProcessName !== 'string' ||
          body.captureProcessName.trim() === '' ||
          body.captureProcessName.trim().length > 64)
      ) {
        return c.json({ error: 'captureProcessName must be a non-empty string of at most 64 characters when given' }, 400)
      }
      const captureProcessName =
        typeof body?.captureProcessName === 'string' ? body.captureProcessName.trim() : undefined
      if (capturePid !== undefined && captureProcessName !== undefined) {
        return c.json({ error: 'give capturePid or captureProcessName, not both' }, 400)
      }
      if (captureProcessName !== undefined) {
        let resolved: number | null
        try {
          resolved = await resolveCaptureProcessId(captureProcessName)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn({ captureProcessName, error: message }, 'capture process lookup failed')
          return c.json({ error: `could not resolve captureProcessName: ${message}` }, 400)
        }
        if (resolved === null) {
          return c.json(
            { error: `no running process named '${captureProcessName}' — is the call app open?` },
            400,
          )
        }
        capturePid = resolved
      }
      try {
        const descriptor = roster.startCall({
          label,
          mode,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(capturePid !== undefined ? { capturePid } : {}),
        })
        // A call app's auto-gain drags the virtual mic's system slider (found
        // live at 8% — quiet, garbled far end). Fire-and-forget: the restore
        // is best-effort by contract and must not delay the start response.
        if (process.platform === 'win32') void restoreMicLevels()
        return c.json(descriptor)
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
