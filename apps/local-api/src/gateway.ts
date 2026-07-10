// The daemon's front door. In sidecar mode (the Tauri shell's windows load
// from this process) it hosts the whole desktop experience; in dev it is a
// transparent superset of the bare api. Route order is the contract:
//
//   /api/*   -> the api app, prefix stripped (the SDK client's baseUrl '/api'
//               — identical semantics to the Vite dev proxy, which forwards
//               /api without rewriting)
//   /voice/* -> proxied to the voice daemon's overlay channel (SSE wake
//               events, /synthesize, /session/end) — the Vite dev proxy's
//               production twin. Shadows the api's own /voice at root paths
//               on purpose: externally that surface is /api/voice/* — every
//               out-of-process SDK/MCP consumer dispatches through the /api
//               mount (apps/mcp external-server.ts, apps/cli bin.ts) — and
//               the in-process appRequest binds the inner api app, never
//               crossing the gateway.
//   files    -> the built local-web bundle, when a dist exists (static-web-ui)
//   GET nav  -> index.html (SPA fallback for html-accepting GETs of UI routes)
//   *        -> the api app at root paths (compat: the voice daemon's brain
//               client POSTs /root/turn directly to the port)

import { Hono } from 'hono'
import type { Logger } from 'pino'
import { resolveWebUiFilePath, respondWithWebUiFile } from './static-web-ui.js'

export interface CreateGatewayAppOptions {
  /** The inner api app — only its fetch surface is needed. */
  readonly apiApp: { fetch: (request: Request) => Response | Promise<Response> }
  /** Absolute dist dir with an index.html; undefined = no UI hosting (dev). */
  readonly webUiDistDir?: string
  readonly voiceDaemonUrl: string
  readonly logger: Logger
  /** Test seam for the voice-daemon proxy. */
  readonly fetchVoiceDaemon?: typeof fetch
}

// Hop-scoped headers the proxy must not forward: fetch computes its own
// host/content-length, and connection semantics don't survive re-origination.
const NON_FORWARDABLE_HEADERS = new Set(['host', 'content-length', 'connection'])

export function createGatewayApp(options: CreateGatewayAppOptions): Hono {
  const gateway = new Hono()
  const fetchVoiceDaemon = options.fetchVoiceDaemon ?? fetch

  gateway.all('/api/*', (c) => {
    const url = new URL(c.req.raw.url)
    url.pathname = url.pathname.slice('/api'.length) || '/'
    return options.apiApp.fetch(new Request(url, c.req.raw))
  })

  gateway.all('/voice/*', async (c) => {
    const incoming = new URL(c.req.raw.url)
    const target = new URL(
      incoming.pathname.slice('/voice'.length) + incoming.search,
      options.voiceDaemonUrl,
    )
    const headers = new Headers()
    c.req.raw.headers.forEach((value, name) => {
      if (!NON_FORWARDABLE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
    })
    try {
      const method = c.req.raw.method
      // Overlay-channel bodies are small JSON — buffering sidesteps streaming
      // duplex requirements. The abort signal tears down the daemon-side SSE
      // connection when the browser closes its EventSource.
      const body =
        method === 'GET' || method === 'HEAD' ? undefined : await c.req.raw.arrayBuffer()
      return await fetchVoiceDaemon(target, {
        method,
        headers,
        signal: c.req.raw.signal,
        ...(body !== undefined ? { body } : {}),
      })
    } catch (error) {
      options.logger.warn(
        { target: target.href, error: error instanceof Error ? error.message : String(error) },
        'gateway: voice daemon unreachable',
      )
      return c.json(
        {
          code: 'voice_daemon_unreachable',
          message: `The voice daemon isn't reachable at ${options.voiceDaemonUrl}. Start it with \`pnpm dev:voice\` — or ignore this if you aren't using voice.`,
        },
        502,
      )
    }
  })

  const webUiDistDir = options.webUiDistDir
  if (webUiDistDir !== undefined) {
    gateway.use('*', async (c, next) => {
      if (c.req.method !== 'GET') return next()
      const requestPath = c.req.path === '/' ? '/index.html' : c.req.path
      const filePath = resolveWebUiFilePath(webUiDistDir, requestPath)
      if (filePath !== null) return respondWithWebUiFile(webUiDistDir, filePath)
      // SPA fallback: a browser navigation (html-accepting GET) to a UI route
      // like /jarvis gets the shell; api-shaped GETs fall through to the api.
      if (c.req.header('accept')?.includes('text/html') === true) {
        const indexPath = resolveWebUiFilePath(webUiDistDir, '/index.html')
        if (indexPath !== null) return respondWithWebUiFile(webUiDistDir, indexPath)
      }
      return next()
    })
  }

  gateway.all('*', (c) => options.apiApp.fetch(c.req.raw))

  return gateway
}
