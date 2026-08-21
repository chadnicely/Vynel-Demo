// Gateway routing contract: /api strip-mount, /voice daemon proxy, static
// web-ui hosting + SPA fallback, root-path api passthrough — the exact order
// the sidecar mode depends on — plus the open /health and the remote-mode
// bearer gate.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import pino from 'pino'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGatewayApp, type CreateGatewayAppOptions } from './gateway.js'

const silentLogger = pino({ level: 'silent' })

/** A marker api app: every request answers with what it saw. */
function buildFakeApiApp(): Hono {
  const api = new Hono()
  api.all('*', async (c) => {
    const body = c.req.method === 'POST' ? await c.req.text() : null
    return c.json({ seenPath: c.req.path, seenMethod: c.req.method, seenBody: body })
  })
  return api
}

function baseGatewayOptions(): CreateGatewayAppOptions {
  return {
    apiApp: buildFakeApiApp(),
    voiceDaemonUrl: 'http://127.0.0.1:8997',
    appVersion: '9.9.9-test',
    logger: silentLogger,
  }
}

function buildWebUiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), 'vynel-gateway-test-'))
  writeFileSync(join(distDir, 'index.html'), '<html>vynel shell</html>')
  mkdirSync(join(distDir, 'assets'))
  writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log("app")')
  return distDir
}

describe('createGatewayApp', () => {
  let distDir: string

  beforeEach(() => {
    distDir = buildWebUiDist()
  })

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  it('strips the /api prefix and delegates to the api app', async () => {
    const gateway = createGatewayApp(baseGatewayOptions())
    const response = await gateway.request('/api/workspaces/w1/chat')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ seenPath: '/workspaces/w1/chat' })
  })

  it('preserves method and body through the /api mount', async () => {
    const gateway = createGatewayApp(baseGatewayOptions())
    const response = await gateway.request('/api/root/turn', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(await response.json()).toMatchObject({
      seenPath: '/root/turn',
      seenMethod: 'POST',
      seenBody: JSON.stringify({ text: 'hello' }),
    })
  })

  it('proxies /voice/* to the voice daemon, preserving path + query', async () => {
    const fetchVoiceDaemon = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('daemon-says-hi', { status: 200 }))
    const gateway = createGatewayApp({
      ...baseGatewayOptions(),
      fetchVoiceDaemon,
    })
    const response = await gateway.request('/voice/events?surface=dock')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('daemon-says-hi')
    const target = fetchVoiceDaemon.mock.calls[0]?.[0] as URL
    expect(target.href).toBe('http://127.0.0.1:8997/events?surface=dock')
  })

  it('answers 502 with an actionable message when the voice daemon is down', async () => {
    const fetchVoiceDaemon = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'))
    const gateway = createGatewayApp({
      ...baseGatewayOptions(),
      fetchVoiceDaemon,
    })
    const response = await gateway.request('/voice/session/end', { method: 'POST' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'voice_daemon_unreachable' })
  })

  it('serves the web ui when a dist dir is configured', async () => {
    const gateway = createGatewayApp({
      ...baseGatewayOptions(),
      webUiDistDir: distDir,
    })
    const indexResponse = await gateway.request('/')
    expect(indexResponse.headers.get('content-type')).toContain('text/html')
    expect(await indexResponse.text()).toBe('<html>vynel shell</html>')

    const assetResponse = await gateway.request('/assets/app-abc123.js')
    expect(assetResponse.headers.get('content-type')).toContain('text/javascript')
    expect(assetResponse.headers.get('cache-control')).toContain('immutable')
  })

  it('falls back to index.html for html-accepting GETs of UI routes', async () => {
    const gateway = createGatewayApp({
      ...baseGatewayOptions(),
      webUiDistDir: distDir,
    })
    const response = await gateway.request('/display-dock', {
      headers: { accept: 'text/html,application/xhtml+xml' },
    })
    expect(await response.text()).toBe('<html>vynel shell</html>')
  })

  it('passes api-shaped root-path requests through to the api app', async () => {
    const gateway = createGatewayApp({
      ...baseGatewayOptions(),
      webUiDistDir: distDir,
    })
    // The voice daemon's brain client POSTs /root/turn directly to the port.
    const postResponse = await gateway.request('/root/turn', { method: 'POST', body: '{}' })
    expect(await postResponse.json()).toMatchObject({ seenPath: '/root/turn' })
    // A json-accepting GET is not a navigation — it reaches the api, not the SPA.
    const getResponse = await gateway.request('/workspaces', {
      headers: { accept: 'application/json' },
    })
    expect(await getResponse.json()).toMatchObject({ seenPath: '/workspaces' })
  })

  it('never serves files outside the dist dir', async () => {
    const outsideFileName = `vynel-gateway-outside-${Date.now()}.txt`
    const outsideFileContent = 'OUTSIDE-DIST-FILE-CONTENT'
    writeFileSync(join(distDir, '..', outsideFileName), outsideFileContent)
    try {
      const gateway = createGatewayApp({
        ...baseGatewayOptions(),
        webUiDistDir: distDir,
      })
      // Layered defense: URL parsing collapses `..` AND single-encoded
      // `%2e%2e` dot-segments before routing; the DOUBLE-encoded form passes
      // through routing and is what actually reaches the resolver's
      // containment guard (its second decode + resolve, static-web-ui.ts).
      const traversals = [
        `/../${outsideFileName}`,
        `/%2e%2e/${outsideFileName}`,
        `/%252e%252e/${outsideFileName}`,
      ]
      for (const path of traversals) {
        const response = await gateway.request(path)
        expect(await response.text()).not.toContain(outsideFileContent)
      }
    } finally {
      rmSync(join(distDir, '..', outsideFileName), { force: true })
    }
  })

  it('is a pure api passthrough when no dist dir is configured', async () => {
    const gateway = createGatewayApp(baseGatewayOptions())
    const response = await gateway.request('/', { headers: { accept: 'text/html' } })
    expect(await response.json()).toMatchObject({ seenPath: '/' })
  })

  it('reports liveness + version on /health', async () => {
    const gateway = createGatewayApp(baseGatewayOptions())
    const response = await gateway.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '9.9.9-test' })
  })

  describe('bearer gate (remote engine mode)', () => {
    const token = 'a-long-remote-engine-token'

    it('401s every surface without the exact bearer', async () => {
      const gateway = createGatewayApp({
        ...baseGatewayOptions(),
        webUiDistDir: distDir,
        authToken: token,
      })
      const surfaces = ['/api/workspaces', '/root/turn', '/', '/voice/events', '/assets/app-abc123.js']
      for (const path of surfaces) {
        const bare = await gateway.request(path)
        expect(bare.status, `${path} without a token`).toBe(401)
        const wrong = await gateway.request(path, {
          headers: { authorization: 'Bearer wrong-token-of-other-length' },
        })
        expect(wrong.status, `${path} with a wrong token`).toBe(401)
        // Same length as the real token — exercises the timingSafeEqual
        // branch, not just the length short-circuit.
        const sameLength = await gateway.request(path, {
          headers: { authorization: 'Bearer a-long-remote-engine-tokeX' },
        })
        expect(sameLength.status, `${path} with a same-length wrong token`).toBe(401)
      }
    })

    it('admits the exact bearer on every surface', async () => {
      const gateway = createGatewayApp({
        ...baseGatewayOptions(),
        webUiDistDir: distDir,
        authToken: token,
      })
      const authorized = { headers: { authorization: `Bearer ${token}` } }
      const api = await gateway.request('/api/workspaces', authorized)
      expect(await api.json()).toMatchObject({ seenPath: '/workspaces' })
      const index = await gateway.request('/', authorized)
      expect(await index.text()).toBe('<html>vynel shell</html>')
    })

    it('leaves /health open without a token', async () => {
      const gateway = createGatewayApp({ ...baseGatewayOptions(), authToken: token })
      const response = await gateway.request('/health')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'ok' })
    })
  })
})
