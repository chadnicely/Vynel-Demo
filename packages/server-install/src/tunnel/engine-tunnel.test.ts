// The tunnel proven over a REAL ssh2 hop: local listener → fake ssh server's
// direct-tcpip → a loopback "remote daemon". Asserts the bearer is injected
// on the way through (the remote sees it; the client never sent it), bodies
// round-trip, and an unreachable remote answers 502 instead of hanging.

import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { startFakeSshServer } from '@vynel/testing'
import { startEngineTunnel, type EngineTunnel } from './engine-tunnel.js'

async function startFakeRemoteDaemon(): Promise<{
  port: number
  seenAuthHeaders: (string | undefined)[]
  close(): Promise<void>
}> {
  const seenAuthHeaders: (string | undefined)[] = []
  const server = http.createServer((request, response) => {
    seenAuthHeaders.push(request.headers.authorization)
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', version: '3.3.3' }))
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ echo: body, path: request.url }))
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  return {
    port: (server.address() as AddressInfo).port,
    seenAuthHeaders,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  }
}

async function startTunnelAgainstFake(remotePort: number): Promise<{
  tunnel: EngineTunnel
  closeAll(): Promise<void>
}> {
  const sshServer = await startFakeSshServer({ enableForwarding: true })
  const tunnel = await startEngineTunnel({
    host: '127.0.0.1',
    port: sshServer.port,
    username: 'dana',
    credentials: { authKind: 'password', password: 'sourdough' },
    pinnedHostKeyFingerprint: null,
    authToken: 'tunnel-bearer-token-abc123',
    localPort: 0,
    remotePort,
  })
  return {
    tunnel,
    closeAll: async () => {
      await tunnel.close()
      await sshServer.close()
    },
  }
}

describe('startEngineTunnel', () => {
  it('forwards requests over ssh, injecting the bearer the client never sent', async () => {
    const remote = await startFakeRemoteDaemon()
    const { tunnel, closeAll } = await startTunnelAgainstFake(remote.port)
    try {
      const health = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: 'ok', version: '3.3.3' })

      const posted = await fetch(`http://127.0.0.1:${tunnel.localPort}/api/echo?x=1`, {
        method: 'POST',
        body: 'hello-through-the-tunnel',
      })
      expect(await posted.json()).toEqual({
        echo: 'hello-through-the-tunnel',
        path: '/api/echo?x=1',
      })

      expect(remote.seenAuthHeaders).toEqual([
        'Bearer tunnel-bearer-token-abc123',
        'Bearer tunnel-bearer-token-abc123',
      ])
    } finally {
      await closeAll()
      await remote.close()
    }
  })

  it('redials after the ssh connection drops and keeps serving', async () => {
    const remote = await startFakeRemoteDaemon()
    const sshServer = await startFakeSshServer({ enableForwarding: true })
    const tunnel = await startEngineTunnel({
      host: '127.0.0.1',
      port: sshServer.port,
      username: 'dana',
      credentials: { authKind: 'password', password: 'sourdough' },
      pinnedHostKeyFingerprint: null,
      authToken: 'tunnel-bearer-token-abc123',
      localPort: 0,
      remotePort: remote.port,
    })
    try {
      const before = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
      expect(before.status).toBe(200)

      sshServer.dropConnections()
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))

      // First request after the drop may land on the dead client (502) — the
      // redial (with its backoff) must bring service back within a few tries.
      let recovered = false
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const after = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
        if (after.status === 200) {
          recovered = true
          break
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
      }
      expect(recovered).toBe(true)
    } finally {
      await tunnel.close()
      await sshServer.close()
      await remote.close()
    }
  })

  it('answers 502 with an actionable body when the remote daemon is down', async () => {
    const remote = await startFakeRemoteDaemon()
    await remote.close()
    const { tunnel, closeAll } = await startTunnelAgainstFake(remote.port)
    try {
      const response = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ code: 'remote_engine_unreachable' })
    } finally {
      await closeAll()
    }
  })

  it('fails the start loudly on a wrong credential instead of listening dead', async () => {
    const sshServer = await startFakeSshServer({ enableForwarding: true })
    try {
      await expect(
        startEngineTunnel({
          host: '127.0.0.1',
          port: sshServer.port,
          username: 'dana',
          credentials: { authKind: 'password', password: 'wrong' },
          pinnedHostKeyFingerprint: null,
          authToken: 'tunnel-bearer-token-abc123',
          localPort: 0,
          remotePort: 1,
        }),
      ).rejects.toThrow(/Could not connect/)
    } finally {
      await sshServer.close()
    }
  })
})
