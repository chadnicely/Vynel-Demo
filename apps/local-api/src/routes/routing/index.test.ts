// Route tests for the routing surface — full HTTP stack against a local harness
// that mounts `routingApp` at `/routing` with the same DI middleware + VynelError
// onError `createApp` wires (routingApp is not mounted in app.ts yet — switch this
// harness to `createApp` from ../../app.js once the integrator mounts it; the
// rootApp test precedent). Real SQLite via `@vynel/testing`; no provider or MCP
// mocks needed — these routes only enqueue/read, they never run a turn.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { AiAgentProvider, NormalizedSessionEvent } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '@vynel/orchestration'
import { createSpawnedSession } from '@vynel/session/spawned'
import { withVynelUserDataDir } from '../../sessions/global-root-workspace.js'
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

describe('POST /routing/delegate-session (Slice ④ — send_task_to_session)', () => {
  // The spawn-time priming turn, faked (session-started + completed).
  function makePrimingProvider(sessionId: string): AiAgentProvider {
    return {
      startChatSession(): AsyncIterable<NormalizedSessionEvent> {
        return (async function* () {
          yield {
            kind: 'session-started',
            sessionId,
            resumedFromExisting: false,
            startedAt: new Date(),
          } as NormalizedSessionEvent
          yield {
            kind: 'session-completed',
            sessionId,
            isNewSession: true,
            completedAt: new Date(),
          } as NormalizedSessionEvent
        })()
      },
    } as unknown as AiAgentProvider
  }

  async function seedSpawnedSession(
    db: Database,
    userId: string,
    sdkSessionId = 'sdk-sp-1',
    workspace?: { id: string; path: string },
  ) {
    return createSpawnedSession(db, makePrimingProvider(sdkSessionId), {
      userId,
      name: 'Research: pricing',
      purpose: 'compare pricing pages',
      workspacePath: workspace?.path ?? '/tmp/vynel/global-root',
      ...(workspace !== undefined ? { workspaceId: workspace.id } : {}),
    })
  }

  // A live WORKSPACE primary (the ④b creator conversation) — the workspace
  // sibling of seedLinkedGlobalRoot.
  async function seedLinkedWorkspacePrimary(
    db: Database,
    userId: string,
    workspaceId: string,
    sdkSessionId = 'ws-primary-1',
  ) {
    const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
    insertChatSession(
      db,
      buildNewChatSessionRow({
        sessionId: sdkSessionId,
        userId,
        workspaceId,
        providerId: 'claude',
        startedAt: new Date(),
        title: 'Workspace brain',
        visibility: 'hidden',
      }),
    )
    linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
    return sdkSessionId
  }

  it('enqueues a SESSION-target job keyed by the spawned primary, run cwd = the global-root dir', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        await seedLinkedGlobalRoot(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id)
        const app = makeHarness(db)

        const res = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 'compare pricing',
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { status: string; jobId: string; sessionName: string }
        expect(body.status).toBe('enqueued')
        expect(body.sessionName).toBe('Research: pricing')

        const job = findDelegationJobById(db, body.jobId)
        expect(job?.status).toBe('pending')
        expect(job?.targetPrimarySessionId).toBe(spawned.primarySessionId)
        expect(job?.workspaceId).toBeNull()
        expect(job?.workspaceName).toBeNull()
        expect(job?.workspacePath).toBe(path.join(dataDir, 'global-root'))
        expect(job?.parentSessionId).toBe('g-1')
      })
    })
  })

  it('a WORKSPACE-origin call (Slice ④b) parents the job on the workspace primary and runs in the TARGET session ground — no global root needed', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-ws-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id)
        // Deliberately NO global root: the relaxed guard accepts an active
        // CREATOR conversation — here, the workspace primary.
        const wsPrimarySdkId = await seedLinkedWorkspacePrimary(db, user.id, workspace.id)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-ws', workspace)
        const app = makeHarness(db)

        const res = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 'dig into the backlog',
          workspaceId: workspace.id,
        })
        expect(res.status).toBe(200)
        const { jobId } = (await res.json()) as { jobId: string }

        const job = findDelegationJobById(db, jobId)
        expect(job?.status).toBe('pending')
        expect(job?.targetPrimarySessionId).toBe(spawned.primarySessionId)
        // Parent = the WORKSPACE primary's current SDK session (the creator).
        expect(job?.parentSessionId).toBe(wsPrimarySdkId)
        // Run cwd = the TARGET's ground (its creating workspace's path).
        expect(job?.workspacePath).toBe(workspace.path)

        // A GLOBAL-spawned target keeps ITS ground (the hidden global dir)
        // even when a workspace sends the task — cwd follows the target.
        const globalSpawned = await seedSpawnedSession(db, user.id, 'sdk-sp-global')
        const res2 = await postJson(app, '/routing/delegate-session', {
          targetSessionId: globalSpawned.sessionId,
          task: 't',
          workspaceId: workspace.id,
        })
        expect(res2.status).toBe(200)
        const { jobId: jobId2 } = (await res2.json()) as { jobId: string }
        expect(findDelegationJobById(db, jobId2)?.workspacePath).toBe(
          path.join(dataDir, 'global-root'),
        )
      })
    })
  })

  it('400s a workspace-origin call whose workspace has no active primary conversation (even with a live global root)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-noprimary-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id)
        await seedLinkedGlobalRoot(db, user.id) // present, but NOT the creator here
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-np', workspace)
        const app = makeHarness(db)

        const res = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 't',
          workspaceId: workspace.id,
        })
        expect(res.status).toBe(400)
      })
    })
  })

  it("404s a workspace-origin call with an unknown or another user's workspaceId", async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-404-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        await seedLinkedGlobalRoot(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id)
        const stranger = seedUser(db)
        const foreignWs = seedWorkspace(db, stranger.id, 'Theirs')
        const app = makeHarness(db)

        const unknown = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 't',
          workspaceId: randomUUID(),
        })
        expect(unknown.status).toBe(404)

        // Not-owned answers exactly like unknown (no enumeration leak).
        const crossUser = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 't',
          workspaceId: foreignWs.id,
        })
        expect(crossUser.status).toBe(404)
      })
    })
  })

  it('400s without an active global-root turn; 404s an unknown or foreign target session', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id)
        const app = makeHarness(db)

        // No linked global root yet → 400 (the delegate-route gate).
        const noRoot = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 't',
        })
        expect(noRoot.status).toBe(400)

        await seedLinkedGlobalRoot(db, user.id)
        // Unknown handle → 404.
        const unknown = await postJson(app, '/routing/delegate-session', {
          targetSessionId: 'sdk-no-such',
          task: 't',
        })
        expect(unknown.status).toBe(404)

        // Another user's spawned session → the same 404 (no enumeration leak).
        const stranger = seedUser(db)
        const theirs = await seedSpawnedSession(db, stranger.id, 'sdk-sp-theirs')
        const crossUser = await postJson(app, '/routing/delegate-session', {
          targetSessionId: theirs.sessionId,
          task: 't',
        })
        expect(crossUser.status).toBe(404)
      })
    })
  })
})
