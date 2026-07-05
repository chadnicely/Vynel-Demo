// Route tests for the routing surface — full HTTP stack against a local harness
// that mounts `routingApp` at `/routing` with the same DI middleware + VynelError
// onError `createApp` wires (routingApp is not mounted in app.ts yet — switch this
// harness to `createApp` from ../../app.js once the integrator mounts it; the
// rootApp test precedent). Real SQLite via `@vynel/testing`; no provider or MCP
// mocks needed — these routes only enqueue/read, they never run a turn.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '@vynel/orchestration'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '@vynel/session/continuity'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession } from '@vynel/chat/repositories'
import {
  seedChannel,
  seedChannelWithAllowedSender,
  listOutboundMessagesForChannel,
} from '@vynel/channels/test-support'
import type { AppEnv } from '../../factory.js'
import {
  serializeDelegationOrigin,
  DELEGATION_ORIGIN_HEADER,
} from '../../sessions/delegation-origin-header.js'
import { DELEGATION_MODE_HEADER } from '../../sessions/delegation-mode-header.js'
import { routingApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

// Mirrors createApp's DI middleware + onError for the not-yet-mounted sub-app.
function makeHarness(db: Database) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/routing', routingApp)
  return app
}

// First-inserted user = the resolved local user (Phase 1 single-user).
function seedUser(db: Database, id: string = randomUUID()) {
  const now = new Date()
  return insertUser(db, {
    id,
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string, name = 'Acme') {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

// A live global root (primary + hidden brain segment + the link) — the delegate
// route requires an active global-root turn as the job's parent.
async function seedLinkedGlobalRoot(db: Database, userId: string, sdkSessionId = 'g-1') {
  const primary = await getOrCreatePrimarySession(db, { userId })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
  linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
  return sdkSessionId
}

function postJson(app: Hono<AppEnv>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('GET /routing/workspaces', () => {
  it('lists the user workspaces as { id, name } routing targets', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await app.request('/routing/workspaces')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([{ id: workspace.id, name: 'Acme' }])
    })
  })
})

describe('POST /routing/delegate', () => {
  it('enqueues the task on the durable queue and returns immediately', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parentSessionId = await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 'summarize the docs',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; jobId: string; workspaceName: string }
      expect(body.status).toBe('enqueued')
      expect(body.workspaceName).toBe('Acme')

      // The durable job carries the task + the enqueue-time parent; no channel origin.
      const job = findDelegationJobById(db, body.jobId)
      expect(job?.status).toBe('pending')
      expect(job?.taskText).toBe('summarize the docs')
      expect(job?.parentSessionId).toBe(parentSessionId)
      expect(job?.originChannelId).toBeNull()
    })
  })

  it('stamps the channel origin from the internal header onto the job (Ch4)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const origin = { channelId: 'chan-1', externalSenderId: 'tg-42', externalChatContextId: 'chat-7' }
      const res = await postJson(
        app,
        '/routing/delegate',
        { targetWorkspaceId: workspace.id, task: 'summarize' },
        { [DELEGATION_ORIGIN_HEADER]: serializeDelegationOrigin(origin) },
      )
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }

      const job = findDelegationJobById(db, jobId)
      expect(job?.originChannelId).toBe('chan-1')
      expect(job?.originExternalSenderId).toBe('tg-42')
      expect(job?.originExternalChatContextId).toBe('chat-7')
    })
  })

  it('stamps the permission mode from the internal header onto the job (surface-up step 1)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/delegate',
        { targetWorkspaceId: workspace.id, task: 'summarize' },
        { [DELEGATION_MODE_HEADER]: 'ask' },
      )
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }
      expect(findDelegationJobById(db, jobId)?.permissionMode).toBe('ask')
    })
  })

  it('ignores an unknown permission-mode header value (defensive boundary read)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/delegate',
        { targetWorkspaceId: workspace.id, task: 'summarize' },
        { [DELEGATION_MODE_HEADER]: 'yolo' },
      )
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }
      expect(findDelegationJobById(db, jobId)?.permissionMode).toBeNull()
    })
  })

  it('400s when there is no active global-root turn', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 'summarize',
      })
      expect(res.status).toBe(400)
    })
  })

  it('404s on an unknown target workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: randomUUID(),
        task: 'summarize',
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /routing/channels', () => {
  it('lists the user channels as { id, name, kind } send targets', async () => {
    await withTestDatabase(async (db) => {
      // seedChannel inserts its owner FIRST → that user is the resolved local user.
      const { channel } = seedChannel(db)
      const app = makeHarness(db)

      const res = await app.request('/routing/channels')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([{ id: channel.id, name: 'Bakery Bot', kind: 'telegram' }])
    })
  })
})

describe('POST /routing/send-to-channel', () => {
  it('queues the message for the channel owner and acknowledges', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/send-to-channel', {
        channelId: channel.id,
        message: 'Your report is ready.',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'sent', channelId: channel.id })

      // Delivered via the outbound queue — the 2s delivery tick ships it.
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        channelId: channel.id,
        messageBody: 'Your report is ready.',
        payloadKind: 'chat-stream-final',
      })
    })
  })

  it('400s on a disabled channel', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db, { isEnabled: false })
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/send-to-channel', {
        channelId: channel.id,
        message: 'ping',
      })
      expect(res.status).toBe(400)
    })
  })

  it("404s on an unknown channel and on another user's channel (no enumeration leak)", async () => {
    await withTestDatabase(async (db) => {
      seedChannel(db) // its owner is the resolved local user
      const { channel: foreignChannel } = seedChannel(db) // owned by a SECOND user
      const app = makeHarness(db)

      const unknown = await postJson(app, '/routing/send-to-channel', {
        channelId: randomUUID(),
        message: 'ping',
      })
      expect(unknown.status).toBe(404)

      // Same response as unknown — the ownership gate never confirms existence.
      const crossUser = await postJson(app, '/routing/send-to-channel', {
        channelId: foreignChannel.id,
        message: 'ping',
      })
      expect(crossUser.status).toBe(404)
    })
  })
})
