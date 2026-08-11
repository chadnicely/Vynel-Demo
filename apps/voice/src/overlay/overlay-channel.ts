import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import type { VoiceSessionState } from '../loop/voice-session-types.js'

// The daemon↔browser channel for the Jarvis view. The daemon stays the local,
// private WAKE layer; browser surfaces subscribe here (SSE) and, on a wake
// event, own the command session (Web Speech STT + spoken reply). One small
// loopback HTTP surface:
//
//   GET  /events?surface=app|jarvis — SSE: state replay on connect, then
//        {kind:'state'|'wake'|'speak', ...}. Wake and speak events go to ONE
//        client (never all — two sessions would answer twice, two speakers
//        would echo): wake to the newest eligible, speak to the newest of any.
//   POST /session/end — the overlay's command session finished; daemon resumes.
//   POST /synthesize {text} — one spoken sentence as a WAV (Kokoro — the same
//        voice as the native loop), played by the overlay's own audio element.
//
// An undelivered wake is held (`pendingWake`) and replayed to the next
// eligible connect — that is how the same-breath command survives the Jarvis
// window's launch time, and how a wake lost to a dying socket recovers.
//
// CORS is open because the server binds loopback only — the browser may connect
// directly or through the local-web Vite `/voice` proxy.

export type OverlayEvent =
  | { readonly kind: 'state'; readonly state: VoiceSessionState }
  | { readonly kind: 'wake'; readonly command: string }
  // The daemon asks ONE connected client to play a spoken line (the `speak`
  // tool while no overlay session is live — the browser owns reliable playback).
  | { readonly kind: 'speak'; readonly text: string }

export type OverlaySurface = 'app' | 'jarvis'

export interface OverlayChannelHooks {
  /** The overlay posted /session/end — its command session is over. */
  onSessionEnd(): void
  /** The last wake-eligible client disconnected (window closed mid-session). */
  onClientsGone(): void
  /** Synthesize one sentence for the overlay to play (the daemon's TTS voice). */
  onSynthesize(text: string): Promise<Uint8Array>
  /** Speak text aloud through the daemon's own speaker (the `speak` MCP tool —
   *  any global session's voice output). Resolves once the speaker has drained. */
  onSpeak(text: string): Promise<void>
}

export interface OverlayChannelOptions {
  /** 'jarvis' = only the floating window runs wake sessions (app tabs still
   *  get state events + manual sessions); 'any' = the newest client does. */
  readonly wakeSurface: OverlaySurface | 'any'
  /** Extra route groups mounted on this loopback server (the /calls surface) —
   *  they ride the same port and the same local-api `/voice/*` proxy. */
  readonly routes?: ReadonlyArray<{ readonly path: string; readonly app: Hono }>
}

export interface OverlayChannel {
  /** True while at least one browser overlay is subscribed. */
  readonly hasClient: boolean
  /** True while a client eligible for wake delivery is subscribed. */
  readonly hasWakeTarget: boolean
  /** Resolves with the bound port once the server is listening (port 0 = ephemeral). */
  readonly whenListening: Promise<number>
  publishState(state: VoiceSessionState): void
  publishWake(command: string): void
  /** Ask the newest connected client to play a spoken line (single delivery —
   *  two clients would speak twice). Returns false when nobody is connected,
   *  so the caller can fall back to the native speaker. Best-effort beyond
   *  that: a socket dying mid-write drops the line (like any spoken audio). */
  publishSpeak(text: string): boolean
  stop(): void
}

const HEARTBEAT_MS = 15_000

export function startOverlayChannel(
  port: number,
  hooks: OverlayChannelHooks,
  logger: Logger,
  options: OverlayChannelOptions = { wakeSurface: 'any' },
): OverlayChannel {
  // Insertion order = connect order; the wake target is the newest eligible.
  const subscribers = new Map<SSEStreamingApi, OverlaySurface>()
  let lastState: VoiceSessionState = 'idle'
  // A wake no eligible client has confirmed yet — replayed on the next connect,
  // dropped once the daemon leaves the wake state.
  let pendingWake: string | null = null

  const isWakeEligible = (surface: OverlaySurface): boolean =>
    options.wakeSurface === 'any' || surface === options.wakeSurface

  const findWakeTarget = (): SSEStreamingApi | null => {
    let target: SSEStreamingApi | null = null
    for (const [stream, surface] of subscribers) {
      if (isWakeEligible(surface)) target = stream
    }
    return target
  }

  const deliverWake = (stream: SSEStreamingApi, command: string): void => {
    void stream
      .writeSSE({ data: JSON.stringify({ kind: 'wake', command } satisfies OverlayEvent) })
      .then(() => {
        if (pendingWake === command) pendingWake = null
      })
      .catch(() => {
        // Dead socket — keep the wake pending so the next connect replays it.
      })
  }

  const broadcast = (event: OverlayEvent): void => {
    for (const stream of subscribers.keys()) {
      void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {
        // A dead socket surfaces on write — onAbort handles the removal.
      })
    }
  }

  const app = new Hono()
    .use(cors())
    .get('/events', (c) => {
      const surface: OverlaySurface = c.req.query('surface') === 'jarvis' ? 'jarvis' : 'app'
      return streamSSE(c, async (stream) => {
        subscribers.set(stream, surface)
        logger.info({ clients: subscribers.size, surface }, 'overlay connected')

        const closed = new Promise<void>((resolve) => {
          stream.onAbort(() => {
            subscribers.delete(stream)
            logger.info({ clients: subscribers.size, surface }, 'overlay disconnected')
            // Only a lost wake-RUNNER means nobody owns the session anymore —
            // an unrelated tab dropping must not end a live handoff.
            if (isWakeEligible(surface) && findWakeTarget() === null) hooks.onClientsGone()
            resolve()
          })
        })

        await stream.writeSSE({ data: JSON.stringify({ kind: 'state', state: lastState } satisfies OverlayEvent) })
        if (pendingWake !== null && isWakeEligible(surface)) deliverWake(stream, pendingWake)

        // Named 'ping' events keep proxies from idling the socket out; the
        // browser's EventSource ignores them (no listener registered). Only
        // start it if the client survived the replay write, and always clear
        // it after `closed` — clearing inside onAbort raced an abort that
        // landed during the replay, leaking the interval forever.
        let heartbeat: ReturnType<typeof setInterval> | null = null
        if (subscribers.has(stream)) {
          heartbeat = setInterval(() => {
            // A dead socket surfaces on write; onAbort owns the cleanup.
            void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
          }, HEARTBEAT_MS)
        }
        await closed
        if (heartbeat !== null) clearInterval(heartbeat)
      })
    })
    .post('/session/end', (c) => {
      hooks.onSessionEnd()
      return c.json({ ok: true })
    })
    .post('/speak', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 2000) {
        return c.json({ error: 'text must be a non-empty string of at most 2000 characters' }, 400)
      }
      try {
        await hooks.onSpeak(text)
        return c.json({ ok: true })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'overlay speak failed',
        )
        return c.json({ error: 'speak failed — see the daemon log' }, 500)
      }
    })
    .post('/synthesize', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 1000) {
        return c.json({ error: 'text must be a non-empty string of at most 1000 characters' }, 400)
      }
      try {
        const wav = await hooks.onSynthesize(text)
        return c.body(wav.slice().buffer, 200, { 'content-type': 'audio/wav' })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'overlay synthesize failed',
        )
        return c.json({ error: 'synthesis failed — see the daemon log' }, 500)
      }
    })

  for (const group of options.routes ?? []) app.route(group.path, group.app)

  // The executor runs synchronously, so `server` is assigned before any use.
  let server!: ServerType
  const whenListening = new Promise<number>((resolve, reject) => {
    server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (bound) => {
      logger.info({ port: bound.port }, 'overlay channel listening')
      resolve(bound.port)
    })
    // Without this, a bind failure (port taken by another daemon) is an
    // unhandled 'error' event that kills the process with a raw stack.
    server.on('error', (error) => reject(error))
  })

  return {
    get hasClient() {
      return subscribers.size > 0
    },
    get hasWakeTarget() {
      return findWakeTarget() !== null
    },
    whenListening,
    publishState(state: VoiceSessionState): void {
      lastState = state
      if (state !== 'wake') pendingWake = null
      broadcast({ kind: 'state', state })
    },
    publishWake(command: string): void {
      pendingWake = command
      const target = findWakeTarget()
      if (target !== null) deliverWake(target, command)
    },
    publishSpeak(text: string): boolean {
      // Newest client of ANY surface — playback needs a speaker, not wake
      // eligibility (an app tab plays a proactive line as well as the window).
      let target: SSEStreamingApi | null = null
      for (const stream of subscribers.keys()) target = stream
      if (target === null) return false
      void target
        .writeSSE({ data: JSON.stringify({ kind: 'speak', text } satisfies OverlayEvent) })
        .catch(() => {
          // Dead socket — the line is lost, like audio to an unplugged speaker.
        })
      return true
    },
    stop(): void {
      for (const stream of subscribers.keys()) void stream.close()
      subscribers.clear()
      server.close()
    },
  }
}
