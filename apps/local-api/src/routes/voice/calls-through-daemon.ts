import { z } from 'zod'
import { CallDescriptorSchema, type CallDescriptorWire } from './schemas.js'

// Relays to the voice daemon's /calls surface (the speak-through-daemon
// pattern): soft results by contract — a daemon that isn't running yields
// `{ ok: false, reason }` the tool reports honestly, never a thrown 500.
// Timeouts bound a hung daemon; start gets longer because the daemon loads a
// per-call VAD model while handling it.

const START_CALL_TIMEOUT_MS = 8_000
const CALL_TIMEOUT_MS = 4_000
const DAEMON_DOWN_REASON = 'the voice daemon is not running — start it with `pnpm dev:voice`'

export type DaemonCallResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: string }

const ListCallsWireSchema = z.object({ calls: z.array(CallDescriptorSchema) })

export async function startCallThroughDaemon(
  daemonUrl: string,
  request: {
    label: string
    mode: 'notetaker' | 'participant'
    sessionId: string
    capturePid?: number | undefined
    captureProcessName?: string | undefined
  },
): Promise<DaemonCallResult<CallDescriptorWire>> {
  return relay(
    `${daemonUrl}/calls`,
    { method: 'POST', body: request, timeoutMs: START_CALL_TIMEOUT_MS },
    (payload) => CallDescriptorSchema.parse(payload),
  )
}

export async function endCallThroughDaemon(
  daemonUrl: string,
  callId: string,
): Promise<DaemonCallResult<CallDescriptorWire>> {
  return relay(
    `${daemonUrl}/calls/${encodeURIComponent(callId)}`,
    { method: 'DELETE', timeoutMs: CALL_TIMEOUT_MS },
    (payload) => CallDescriptorSchema.parse(payload),
  )
}

export async function listCallsThroughDaemon(
  daemonUrl: string,
): Promise<DaemonCallResult<CallDescriptorWire[]>> {
  return relay(
    `${daemonUrl}/calls`,
    { method: 'GET', timeoutMs: CALL_TIMEOUT_MS },
    (payload) => ListCallsWireSchema.parse(payload).calls,
  )
}

export async function speakIntoCallThroughDaemon(
  daemonUrl: string,
  callId: string,
  text: string,
): Promise<DaemonCallResult<true>> {
  return relay(
    `${daemonUrl}/calls/${encodeURIComponent(callId)}/speak`,
    { method: 'POST', body: { text }, timeoutMs: CALL_TIMEOUT_MS },
    () => true as const,
  )
}

async function relay<Value>(
  url: string,
  init: { method: string; body?: unknown; timeoutMs: number },
  parse: (payload: unknown) => Value,
): Promise<DaemonCallResult<Value>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      ...(init.body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }
        : {}),
      signal: AbortSignal.timeout(init.timeoutMs),
    })
  } catch {
    return { ok: false, reason: DAEMON_DOWN_REASON }
  }
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const daemonError =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `the voice daemon returned ${response.status}`
    return { ok: false, reason: daemonError }
  }
  try {
    return { ok: true, value: parse(payload) }
  } catch {
    return { ok: false, reason: 'the voice daemon returned an unexpected shape — versions may be out of sync' }
  }
}
