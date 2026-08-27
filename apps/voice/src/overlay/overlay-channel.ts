import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import { DISPLAY_SESSION_CAPTION_MAX_LENGTH } from '@vynel/contracts/voice/daemon-events'
import type { VoiceReloadOutcome } from '@vynel/contracts/voice/voice-reload'
import type { VoiceSessionState } from '../loop/voice-session-types.js'
import { VoiceNotReadyError } from '../voice-engine-slot.js'

// The daemon↔browser channel for the voice views. The daemon stays the local,
// private WAKE layer; browser surfaces subscribe here (SSE) and, on a wake
// event, own the command session (Web Speech STT + spoken reply). One small
// loopback HTTP surface:
//
//   GET  /events?surface=app|dock&wake=1|0 — SSE: state replay on connect,
//        then {kind:'state'|'wake'|'speak'|'show-display', ...}. `show-display`
//        is the only one addressed by SURFACE (app windows only): it asks the
//        desktop app to come forward on the Display while the dock holds the
//        conversation. `wake` declares whether the
//        client can RUN a command session (the display dock always can; an app
//        tab only with Web Speech). Wake and speak events go to ONE client
//        (never all — two sessions would answer twice, two speakers would
//        echo): wake to the newest CAPABLE eligible client; speak to the
//        HANDOFF OWNER (the client that took the wake and still runs the
//        session — its speaker has the room), else to the newest of any.
//   POST /session/start — a browser surface took the microphone WITHOUT a wake
//        (the Display switch, the mic button). The daemon hands the room over so
//        its native STT stops transcribing speech the web recognizer owns.
//   POST /session/end — the overlay's command session finished; daemon resumes.
//   POST /speak {text, sessionId?} — a session's spoken line, routed by the
//        daemon (main.ts); `sessionId` = the producing chat session, carried
//        on the relayed event so a client can tell its own turn's line apart.
//   POST /synthesize {text} — one spoken sentence as a WAV (Kokoro — the same
//        voice as the native loop), played by the overlay's own audio element.
//
// An undelivered wake is held (`pendingWake`) and replayed to the next
// eligible connect — that is how the same-breath command survives the dock
// window's launch time, and how a wake lost to a dying socket recovers.
//
// CORS is open because the server binds loopback only — the browser may connect
// directly or through the local-web Vite `/voice` proxy.

/** The conversation phase as the WIRE carries it: the driver's own states plus
 *  this channel's own word. `handed-off` is not a driver state — the driver
 *  publishes `wake` and then goes silent for the whole handoff, so without it a
 *  dock conversation parks at `wake` for its entire life and no surface can
 *  tell "a wake just fired" from "the dock is holding the room". Only this
 *  channel knows the difference: it is the one that delivered the wake. */
export type OverlayPhase = VoiceSessionState | 'handed-off'

export type OverlayEvent =
  | { readonly kind: 'state'; readonly state: OverlayPhase }
  // `turnWatchdogMs` mirrors the daemon's per-turn watchdog knob so the browser
  // leg bounds its turns from the same single home (env) as the native leg.
  | { readonly kind: 'wake'; readonly command: string; readonly turnWatchdogMs: number }
  // The daemon asks ONE connected client to play a spoken line. `sessionId` is
  // null when the producer is unknown (a caller without a turn session).
  | { readonly kind: 'speak'; readonly text: string; readonly sessionId: string | null }
  // Bring the desktop app forward on the Display. App surfaces only.
  | { readonly kind: 'show-display' }
  // A spoken line is about to be heard — the dock should be on screen for it,
  // with the line's opening as its caption (the audio may play in ANOTHER
  // window, so the caption has to ride this event, not the playback).
  // Dock surfaces only, broadcast (whichever window plays it, the dock shows).
  | { readonly kind: 'show-dock'; readonly text: string }

export type OverlaySurface = 'app' | 'dock'

export interface OverlayChannelHooks {
  /** The overlay posted /session/start — a web recognizer now owns the mic,
   *  with no wake to have handed it over. */
  onSessionStart(): void
  /** The overlay posted /session/end — its command session is over. */
  onSessionEnd(): void
  /** The client running the handed-off session disconnected — or the last one
   *  able to run it did (window closed mid-session). */
  onClientsGone(): void
  /** Synthesize one sentence for the overlay to play (the daemon's TTS voice). */
  onSynthesize(text: string): Promise<Uint8Array>
  /** Speak text aloud — the `speak` MCP tool (any global session's voice
   *  output); `sessionId` = the producing chat session, null when unknown.
   *  Resolves once the line is accepted for playback. */
  onSpeak(text: string, sessionId: string | null): Promise<void>
  /** A browser client the daemon delegated a line to could not START playing
   *  it (autoplay policy — zero audio came out). The daemon believed it was
   *  delivered; this is its chance to speak the line another way. */
  onSpeakRefused(text: string): void
  /** Re-read the user's voice pick and apply it (Settings → Voice saved). */
  onReload(): Promise<VoiceReloadOutcome>
}

export interface OverlayChannelOptions {
  /** Which surface's capable clients may take a wake: 'dock' = only the
   *  display dock (app tabs still get state events + manual sessions);
   *  'app' = only a capable app tab — the window feature is off, and the
   *  desktop shell's hidden dock webview (connected regardless) must not
   *  swallow the wake; 'any' = the newest capable client of either. */
  readonly wakeSurface: OverlaySurface | 'any'
  /** The daemon's per-turn watchdog, carried on every wake event. */
  readonly turnWatchdogMs: number
  /** Extra route groups mounted on this loopback server (the /calls surface) —
   *  they ride the same port and the same local-api `/voice/*` proxy. */
  readonly routes?: ReadonlyArray<{ readonly path: string; readonly app: Hono }>
}

export interface OverlayChannel {
  /** True while at least one browser overlay is subscribed. */
  readonly hasClient: boolean
  /** True while a client able to run a wake session — and eligible for one — is subscribed. */
  readonly hasWakeTarget: boolean
  /** Resolves with the bound port once the server is listening (port 0 = ephemeral). */
  readonly whenListening: Promise<number>
  publishState(state: VoiceSessionState): void
  publishWake(command: string): void
  /** Ask ONE connected client to play a spoken line — the handoff owner while a
   *  session is live, else the newest client (two clients would speak twice).
   *  Returns false when nobody is connected, so the caller can fall back to the
   *  native speaker. Best-effort beyond that: a socket dying mid-write drops
   *  the line (like any spoken audio). */
  publishSpeak(text: string, sessionId: string | null): boolean
  /** Ask the DESKTOP APP to come forward on the Display (a wake landed). App
   *  surfaces only — the dock is the wake window and already has the room. */
  publishShowDisplay(): void
  /** Ask the DOCK to be on screen — a spoken line is about to play and a voice
   *  with no pixels anywhere is a voice from nowhere. Dock surfaces only, and
   *  broadcast, unlike the single-delivery `speak`: the dock must appear
   *  whichever client ends up playing the audio. `text` = the line, clamped
   *  here to the caption cap. */
  publishShowDock(text: string): void
  stop(): void
}

interface Subscriber {
  readonly surface: OverlaySurface
  /** Declared at subscribe — a connected client with no speech recognizer (the
   *  desktop main window) must never be handed a wake it cannot answer. */
  readonly wakeCapable: boolean
}

const HEARTBEAT_MS = 15_000

function parseSubscriber(surfaceQuery: string | undefined, wakeQuery: string | undefined): Subscriber {
  const surface: OverlaySurface = surfaceQuery === 'dock' ? 'dock' : 'app'
  return { surface, wakeCapable: surface === 'dock' || wakeQuery === '1' }
}

export function startOverlayChannel(
  port: number,
  hooks: OverlayChannelHooks,
  logger: Logger,
  options: OverlayChannelOptions,
): OverlayChannel {
  // Insertion order = connect order; the wake target is the newest eligible.
  const subscribers = new Map<SSEStreamingApi, Subscriber>()
  let lastState: OverlayPhase = 'idle'
  // A wake no eligible client has confirmed yet — replayed on the next connect,
  // dropped once the daemon leaves the wake state.
  let pendingWake: string | null = null
  // The client that last took a wake — it runs the command session until it
  // posts /session/end or disconnects, and relayed speak lines belong to it.
  let handoffOwner: SSEStreamingApi | null = null

  const isWakeEligible = (subscriber: Subscriber): boolean =>
    subscriber.wakeCapable &&
    (options.wakeSurface === 'any' || subscriber.surface === options.wakeSurface)

  const findWakeTarget = (): SSEStreamingApi | null => {
    let target: SSEStreamingApi | null = null
    for (const [stream, subscriber] of subscribers) {
      if (isWakeEligible(subscriber)) target = stream
    }
    return target
  }

  const findSpeakTarget = (): SSEStreamingApi | null => {
    if (handoffOwner !== null) return handoffOwner
    // Newest client of ANY surface — playback needs a speaker, not wake
    // eligibility (an app tab plays a proactive line as well as the window).
    let target: SSEStreamingApi | null = null
    for (const stream of subscribers.keys()) target = stream
    return target
  }

  const broadcast = (event: OverlayEvent, where: (subscriber: Subscriber) => boolean = () => true): void => {
    for (const [stream, subscriber] of subscribers) {
      if (!where(subscriber)) continue
      void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {
        // A dead socket surfaces on write — onAbort handles the removal.
      })
    }
  }

  /** Remember the phase (a late connect replays it) and tell everyone. Split
   *  from `publishState` because `handed-off` must NOT clear a pending wake. */
  const broadcastState = (state: OverlayPhase): void => {
    lastState = state
    broadcast({ kind: 'state', state })
  }

  const deliverWake = (stream: SSEStreamingApi, command: string): void => {
    handoffOwner = stream
    const event: OverlayEvent = { kind: 'wake', command, turnWatchdogMs: options.turnWatchdogMs }
    void stream
      .writeSSE({ data: JSON.stringify(event) })
      .then(() => {
        if (pendingWake === command) pendingWake = null
        // A CONFIRMED write is the moment the room changed hands — and the one
        // place that knows it. Publishing it from the driver instead would run
        // while the wake is still pending and, worse, `publishState` would null
        // that pending wake: the dock would connect to a session nobody handed
        // it and the daemon would sit handed-off to no one.
        broadcastState('handed-off')
      })
      .catch(() => {
        // Dead socket — keep the wake pending so the next connect replays it.
      })
  }

  const app = new Hono()
    .use(cors())
    .get('/events', (c) => {
      const subscriber = parseSubscriber(c.req.query('surface'), c.req.query('wake'))
      return streamSSE(c, async (stream) => {
        subscribers.set(stream, subscriber)
        logger.info({ clients: subscribers.size, ...subscriber }, 'overlay connected')

        const closed = new Promise<void>((resolve) => {
          stream.onAbort(() => {
            subscribers.delete(stream)
            logger.info({ clients: subscribers.size, ...subscriber }, 'overlay disconnected')
            const wasOwner = handoffOwner === stream
            if (wasOwner) handoffOwner = null
            // The session runner is gone — the owner itself, or the last client
            // that could have taken the wake — so nobody owns the handoff; an
            // unrelated tab dropping must not end a live session.
            if (wasOwner || (isWakeEligible(subscriber) && findWakeTarget() === null)) {
              hooks.onClientsGone()
            }
            resolve()
          })
        })

        await stream.writeSSE({ data: JSON.stringify({ kind: 'state', state: lastState } satisfies OverlayEvent) })
        if (pendingWake !== null && isWakeEligible(subscriber)) deliverWake(stream, pendingWake)

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
    .post('/session/start', (c) => {
      hooks.onSessionStart()
      return c.json({ ok: true })
    })
    .post('/session/end', (c) => {
      handoffOwner = null
      hooks.onSessionEnd()
      return c.json({ ok: true })
    })
    .post('/speak', async (c) => {
      const body = (await c.req.json().catch(() => null)) as
        | { text?: unknown; sessionId?: unknown }
        | null
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 2000) {
        return c.json({ error: 'text must be a non-empty string of at most 2000 characters' }, 400)
      }
      const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null
      try {
        await hooks.onSpeak(text, sessionId)
        return c.json({ ok: true })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'overlay speak failed',
        )
        return c.json({ error: 'speak failed — see the daemon log' }, 500)
      }
    })
    // A delegated line's playback was REFUSED by the browser (autoplay policy)
    // — without this door the daemon logs "delivered" while nothing was heard.
    .post('/speak-refused', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 2000) {
        return c.json({ error: 'text must be a non-empty string of at most 2000 characters' }, 400)
      }
      hooks.onSpeakRefused(text)
      return c.json({ ok: true })
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
        // Not a failure: the daemon is up and simply has no voice model yet.
        // 503 (not 500) — the player stays quiet, nothing is logged as broken.
        if (error instanceof VoiceNotReadyError) return c.json({ error: error.message }, 503)
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'overlay synthesize failed',
        )
        return c.json({ error: 'synthesis failed — see the daemon log' }, 500)
      }
    })

    // Settings → Voice saved a new pick — apply it now rather than at the next
    // daemon start. The outcome says what actually changed and what is
    // missing from the disk, so the screen can be honest about both.
    .post('/reload', async (c) => {
      try {
        return c.json(await hooks.onReload())
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'overlay reload failed',
        )
        return c.json({ error: 'reload failed — see the daemon log' }, 500)
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
      if (state !== 'wake') pendingWake = null
      broadcastState(state)
    },
    publishWake(command: string): void {
      pendingWake = command
      const target = findWakeTarget()
      if (target !== null) deliverWake(target, command)
    },
    publishSpeak(text: string, sessionId: string | null): boolean {
      const target = findSpeakTarget()
      if (target === null) return false
      const event: OverlayEvent = { kind: 'speak', text, sessionId }
      void target.writeSSE({ data: JSON.stringify(event) }).catch(() => {
        // Dead socket — the line is lost, like audio to an unplugged speaker.
      })
      return true
    },
    publishShowDisplay(): void {
      // Surface, not wake-capability: an app tab that CAN run a wake is still
      // the app, and the dock — the only other surface — is the window the
      // conversation is landing in.
      broadcast({ kind: 'show-display' }, (subscriber) => subscriber.surface === 'app')
    },
    publishShowDock(text: string): void {
      // The line's OPENING, not its tail: the row announces what is about to
      // be said from its first word (display-session clamps to the tail
      // because its caption grows as the reply streams — this one is static).
      broadcast(
        { kind: 'show-dock', text: text.slice(0, DISPLAY_SESSION_CAPTION_MAX_LENGTH) },
        (subscriber) => subscriber.surface === 'dock',
      )
    },
    stop(): void {
      for (const stream of subscribers.keys()) void stream.close()
      subscribers.clear()
      handoffOwner = null
      server.close()
    },
  }
}
