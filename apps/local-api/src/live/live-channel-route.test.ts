// End-to-end for the live channel door: a REAL socket (`ws` client) through a
// REAL bound server running the gateway app — the upgrade path the desktop
// windows and the vite proxy take — plus the DB-backed ownership answer.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { serve, type WebSocketServerLike } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import { TurnEventBroadcaster, traceChannelKey } from '@vynel/session/delegation'
import { LiveChannelHub, SessionActivityFeed, sessionChannelKey } from '@vynel/session/runtime'
import type { LiveChannelServerFrame } from '@vynel/contracts/chat/live-channel'
import { createGatewayApp } from '../gateway.js'
import { buildLiveChannelAuthorizer, createLiveChannelUpgradeHandler } from './live-channel-route.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Database, displayName = 'Dana') {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName,
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Repro',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makeSession(userId: string, workspaceId: string): NewChatSession {
  const now = new Date()
  return {
    id: `sdk-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    visibility: 'listed',
    scope: 'workspace',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

/** A frame reader over a real socket: awaits the next N frames (with a timeout). */
function frameReader(socket: WebSocket) {
  const queue: LiveChannelServerFrame[] = []
  const waiters: Array<() => void> = []
  socket.on('message', (data) => {
    queue.push(JSON.parse(String(data)) as LiveChannelServerFrame)
    waiters.splice(0).forEach((wake) => wake())
  })
  return {
    async next(timeoutMs = 2_000): Promise<LiveChannelServerFrame> {
      const deadline = Date.now() + timeoutMs
      while (queue.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out waiting for a frame')
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, 50)
        })
      }
      return queue.shift()!
    },
    /** Nothing arrives within the window. */
    async expectSilence(windowMs = 150): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, windowMs))
      expect(queue).toEqual([])
    },
  }
}

/** Bind the gateway on an ephemeral port (listen is async — wait for it). */
async function startGateway(gateway: { fetch: (request: Request) => Response | Promise<Response> }) {
  let server!: ReturnType<typeof serve>
  const port = await new Promise<number>((resolve) => {
    server = serve(
      {
        fetch: gateway.fetch,
        hostname: '127.0.0.1',
        port: 0,
        websocket: {
          server: new WebSocketServer({ noServer: true }) as unknown as WebSocketServerLike,
        },
      },
      (info) => resolve(info.port),
    )
  })
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Open a socket with the frame reader attached BEFORE the handshake completes
 *  — `hello` can ride the same flush as the upgrade response and would be
 *  missed by a listener attached after 'open'. */
async function openSocket(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/live`)
  const frames = frameReader(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return { socket, frames }
}

describe('GET /api/live (WebSocket)', () => {
  it('upgrades through the gateway, greets, and multiplexes activity + session + trace on ONE socket', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'session-home',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'do the thing',
      })
      const job = findDelegationJobById(db, jobId)!
      const partialSessionId = job.partialSessionId!

      const turnEvents = new TurnEventBroadcaster()
      const activityFeed = new SessionActivityFeed()
      const hub = new LiveChannelHub({
        turnEvents,
        activityFeed,
        authorizeChannel: buildLiveChannelAuthorizer(db),
      })
      const gateway = createGatewayApp({
        apiApp: { fetch: () => new Response('api', { status: 200 }) },
        voiceDaemonUrl: 'http://127.0.0.1:1',
        appVersion: 'test',
        logger: silentLogger,
        liveChannelUpgrade: createLiveChannelUpgradeHandler({
          hub,
          resolveUserId: () => user.id,
          logger: silentLogger,
        }),
      })
      const server = await startGateway(gateway)
      const { socket, frames } = await openSocket(server.port)
      try {
        expect(await frames.next()).toMatchObject({ kind: 'hello', protocolVersion: 1 })

        // A running turn exists BEFORE the subscribe — the activity replay carries it.
        const running = activityFeed.begin({
          userId: user.id,
          scopeKind: 'workspace',
          workspaceId: workspace.id,
          sessionId: session.id,
          origin: 'web',
        })
        socket.send(
          JSON.stringify({
            op: 'subscribe',
            channels: ['activity', `session:${session.id}`, `trace:${partialSessionId}`],
          }),
        )
        expect(await frames.next()).toEqual({ kind: 'subscribed', channel: 'activity' })
        expect(await frames.next()).toMatchObject({
          kind: 'event',
          channel: 'activity',
          event: { kind: 'turn-started', turnId: running.turnId },
        })
        expect(await frames.next()).toEqual({ kind: 'subscribed', channel: `session:${session.id}` })
        expect(await frames.next()).toEqual({
          kind: 'subscribed',
          channel: `trace:${partialSessionId}`,
        })

        turnEvents.publish(sessionChannelKey(session.id), {
          kind: 'text-chunk',
          messageId: 'm1',
          textDelta: 'hello over the wire',
        })
        turnEvents.publish(traceChannelKey(partialSessionId), {
          kind: 'text-chunk',
          messageId: 'm2',
          textDelta: 'traced',
        })
        turnEvents.end(sessionChannelKey(session.id))
        running.end()
        expect(await frames.next()).toEqual({
          kind: 'event',
          channel: `session:${session.id}`,
          event: { kind: 'text-chunk', messageId: 'm1', textDelta: 'hello over the wire' },
        })
        expect(await frames.next()).toEqual({
          kind: 'event',
          channel: `trace:${partialSessionId}`,
          event: { kind: 'text-chunk', messageId: 'm2', textDelta: 'traced' },
        })
        expect(await frames.next()).toEqual({
          kind: 'channel-ended',
          channel: `session:${session.id}`,
        })
        expect(await frames.next()).toMatchObject({
          kind: 'event',
          channel: 'activity',
          event: { kind: 'turn-ended', turnId: running.turnId },
        })

        // The subscription is standing: the next turn on the session arrives too.
        turnEvents.publish(sessionChannelKey(session.id), {
          kind: 'text-chunk',
          messageId: 'm3',
          textDelta: 'next turn',
        })
        expect(await frames.next()).toMatchObject({
          kind: 'event',
          event: { textDelta: 'next turn' },
        })
        expect(hub.connectionCount()).toBe(1)
      } finally {
        socket.close()
        await new Promise((resolve) => setTimeout(resolve, 50))
        hub.dispose()
        await server.close()
      }
      expect(hub.connectionCount()).toBe(0)
    })
  })

  it('refuses another user’s session and an unknown trace with the not_found frame', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Owner')
      const intruder = seedUser(db, 'Intruder')
      const workspace = seedWorkspace(db, owner.id)
      const theirs = insertChatSession(db, makeSession(owner.id, workspace.id))
      const authorize = buildLiveChannelAuthorizer(db)

      expect(authorize(owner.id, { kind: 'session', sessionId: theirs.id })).toBe(true)
      expect(authorize(intruder.id, { kind: 'session', sessionId: theirs.id })).toBe(false)
      expect(authorize(owner.id, { kind: 'session', sessionId: 'nope' })).toBe(false)
      expect(authorize(owner.id, { kind: 'trace', partialSessionId: 'nope' })).toBe(false)
      expect(authorize(intruder.id, { kind: 'activity' })).toBe(true)

      const hub = new LiveChannelHub({
        turnEvents: new TurnEventBroadcaster(),
        activityFeed: new SessionActivityFeed(),
        authorizeChannel: authorize,
      })
      const gateway = createGatewayApp({
        apiApp: { fetch: () => new Response('api') },
        voiceDaemonUrl: 'http://127.0.0.1:1',
        appVersion: 'test',
        logger: silentLogger,
        liveChannelUpgrade: createLiveChannelUpgradeHandler({
          hub,
          resolveUserId: () => intruder.id,
          logger: silentLogger,
        }),
      })
      const server = await startGateway(gateway)
      const { socket, frames } = await openSocket(server.port)
      try {
        await frames.next() // hello
        socket.send(JSON.stringify({ op: 'subscribe', channels: [`session:${theirs.id}`] }))
        expect(await frames.next()).toMatchObject({
          kind: 'error',
          code: 'not_found',
          channel: `session:${theirs.id}`,
        })
        await frames.expectSilence()
      } finally {
        socket.close()
        await new Promise((resolve) => setTimeout(resolve, 50))
        hub.dispose()
        await server.close()
      }
    })
  })

  it('a plain GET on /api/live (no upgrade) does not crash the gateway and /api/* still forwards', async () => {
    const hub = new LiveChannelHub({
      turnEvents: new TurnEventBroadcaster(),
      activityFeed: new SessionActivityFeed(),
      authorizeChannel: () => true,
    })
    const gateway = createGatewayApp({
      apiApp: { fetch: () => new Response('inner api') },
      voiceDaemonUrl: 'http://127.0.0.1:1',
      appVersion: 'test',
      logger: silentLogger,
      liveChannelUpgrade: createLiveChannelUpgradeHandler({
        hub,
        resolveUserId: () => 'u',
        logger: silentLogger,
      }),
    })
    const forwarded = await gateway.request('/api/anything')
    expect(await forwarded.text()).toBe('inner api')
    // Without an Upgrade header the helper falls through to the api forward —
    // no 500, no hang.
    const plain = await gateway.request('/api/live')
    expect(plain.status).toBeLessThan(500)
    hub.dispose()
  })
})
