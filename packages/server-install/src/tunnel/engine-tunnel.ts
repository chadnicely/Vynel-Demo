// The desktop side of remote mode (Phase D3): a local HTTP listener on the
// ENGINE port that forwards every request over SSH to the remote daemon's
// loopback — injecting the per-install bearer on the way through, so the web
// UI, SDK, and shell windows need zero changes and never see the token. The
// wire is encrypted by SSH; the remote daemon stays 127.0.0.1-only.
//
// Reconnect discipline: ONE ssh client, re-dialed lazily with backoff when a
// request finds it dead. Requests during an outage answer 502 with an
// actionable body instead of hanging.

import http from 'node:http'
import type { Client } from 'ssh2'
import { connectSshClient, type SshClientInput } from '../connecting/ssh-client.js'
import type { StructuralLogger } from '../server-install-types.js'

const RECONNECT_BACKOFF_MS = 2_000

// RFC 7230 hop-by-hop headers must not cross a proxy. Concretely: a copied
// `connection: keep-alive` flips Node into keep-alive on what is a fresh
// forwardOut channel per request — channels linger open and pile up.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function forwardableHeaders(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const filtered: http.IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) filtered[name] = value
  }
  return filtered
}

export interface EngineTunnelInput extends SshClientInput {
  /** The bearer injected on every forwarded request (never logged). */
  authToken: string
  /** Local listen port — the same engine port the whole app hangs on. */
  localPort: number
  /** The remote daemon's loopback port. */
  remotePort: number
  logger?: StructuralLogger
}

export interface EngineTunnel {
  localPort: number
  close(): Promise<void>
}

export async function startEngineTunnel(input: EngineTunnelInput): Promise<EngineTunnel> {
  let client: Client | null = null
  let dialing: Promise<Client> | null = null
  let closed = false
  let lastDialFailureAt = 0

  const dial = async (): Promise<Client> => {
    const connected = await connectSshClient(input)
    if (closed) {
      // close() raced the dial — never leave a live connection behind.
      connected.client.end()
      throw new Error('engine tunnel closed during connect')
    }
    connected.client.on('close', () => {
      if (client === connected.client) client = null
      if (!closed) input.logger?.warn({ host: input.host }, 'engine tunnel: ssh connection closed')
    })
    input.logger?.info({ host: input.host }, 'engine tunnel: ssh connected')
    return connected.client
  }

  const ensureClient = async (): Promise<Client> => {
    if (client !== null) return client
    if (dialing === null) {
      // Backoff between failed dials so a down server isn't hammered by
      // every queued request.
      const sinceFailure = Date.now() - lastDialFailureAt
      const delay = sinceFailure < RECONNECT_BACKOFF_MS ? RECONNECT_BACKOFF_MS - sinceFailure : 0
      dialing = (async () => {
        if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
        return dial()
      })()
        .then((dialedClient) => {
          client = dialedClient
          return dialedClient
        })
        .catch((error: unknown) => {
          lastDialFailureAt = Date.now()
          throw error
        })
        .finally(() => {
          dialing = null
        })
    }
    return dialing
  }

  // First dial happens eagerly so a bad credential/host fails the tunnel
  // start loudly instead of on the first request.
  await ensureClient()

  const server = http.createServer((request, response) => {
    void forwardRequest(request, response)
  })

  async function forwardRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    let sshClient: Client
    try {
      sshClient = await ensureClient()
    } catch (error) {
      answerUnreachable(response, error)
      return
    }
    sshClient.forwardOut('127.0.0.1', 0, '127.0.0.1', input.remotePort, (error, channel) => {
      if (error) {
        // The connection may have died between ensureClient and here — drop
        // the cached client so the next request re-dials (guarded: a request
        // on a STALE client must not clobber a healthy re-dialed one).
        if (client === sshClient) client = null
        answerUnreachable(response, error)
        return
      }
      const upstream = http.request(
        {
          createConnection: () => channel,
          path: request.url ?? '/',
          method: request.method,
          headers: {
            ...forwardableHeaders(request.headers),
            authorization: `Bearer ${input.authToken}`,
          },
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
          upstreamResponse.pipe(response)
          // The channel dying mid-body (SSE streams live for minutes) emits
          // on the RESPONSE object — unhandled, it would crash the process.
          upstreamResponse.on('error', (streamError) => {
            input.logger?.warn(
              { host: input.host, error: streamError.message },
              'engine tunnel: upstream stream failed mid-response',
            )
            response.destroy()
          })
        },
      )
      upstream.on('error', (upstreamError) => {
        answerUnreachable(response, upstreamError)
      })
      // A client aborting mid-request-body emits here; pipe() does not absorb
      // source errors.
      request.on('error', () => {
        upstream.destroy()
      })
      // Local client gone (closed tab mid-SSE): tear the channel down instead
      // of leaking one remote SSE stream per abandoned viewer.
      response.on('close', () => {
        upstream.destroy()
      })
      request.pipe(upstream)
    })
  }

  function answerUnreachable(response: http.ServerResponse, error: unknown): void {
    input.logger?.warn(
      { host: input.host, error: error instanceof Error ? error.message : String(error) },
      'engine tunnel: request failed',
    )
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        code: 'remote_engine_unreachable',
        message: `The remote engine at ${input.host} isn't reachable right now — check the server and your network.`,
      }),
    )
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(input.localPort, '127.0.0.1', () => {
      server.removeListener('error', rejectListen)
      resolveListen()
    })
  })
  // Read the ASSIGNED port — tests listen on 0 (ephemeral).
  const address = server.address()
  const localPort =
    typeof address === 'object' && address !== null ? address.port : input.localPort
  input.logger?.info({ localPort, host: input.host }, 'engine tunnel: listening')

  return {
    localPort,
    close: () =>
      new Promise<void>((resolveClose) => {
        closed = true
        client?.end()
        server.close(() => resolveClose())
      }),
  }
}
