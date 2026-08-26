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
import { findDelegationJobById, enqueueWorkspaceDelegation } from '@vynel/orchestration'
import { createSpawnedSession } from '@vynel/session/spawned'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { withVynelUserDataDir } from '../../sessions/global-root-workspace.js'
import {
  getOrCreatePrimarySession,
  getOrCreateContinuingSession,
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
import { insertChannel } from '@vynel/channels/test-support'
import { DELEGATION_JOB_HEADER } from '../../sessions/delegation-job-header.js'
import {
  serializeReportCaller,
  REPORT_CALLER_HEADER,
  type ReportCaller,
} from '../../sessions/report-caller-header.js'
import { REPORT_REQUESTER_HEADER } from '../../sessions/report-requester-header.js'
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

// Module scope: shared by the report tests and the send_message tests — the
// same seed defined twice would be a drift waiting to happen.
function seedManagedWorkspace(db: Database, userId: string, name = 'Acme') {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    managerName: 'Mark',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

async function seedLinkedWorkspacePrimaryFor(
  db: Database,
  userId: string,
  workspaceId: string,
  sdkSessionId: string,
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
}

// An agent COLLEAGUE (persona-sessions): the agent row + the scope-'agent'
// continuing identity + a linked listed segment — the state a mention run
// leaves behind.
async function seedLinkedColleague(
  db: Database,
  userId: string,
  input: { workspaceId: string | null; slug: string; name: string },
) {
  await createAgent(db, {
    userId,
    workspaceId: null,
    slug: input.slug,
    name: input.name,
    description: 'd',
    prompt: 'p',
    source: 'user',
    trustTier: 'community',
  })
  const colleague = await getOrCreateContinuingSession(db, {
    userId,
    scope: 'agent',
    workspaceId: input.workspaceId,
    scopeRef: input.slug,
  })
  const sdkSessionId = `colleague-${input.slug}-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId: input.workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
      title: input.name,
      scope: 'agent',
    }),
  )
  linkPrimarySessionToSdkSession(db, { primarySessionId: colleague.id, userId, sdkSessionId })
  return { colleagueId: colleague.id, sdkSessionId }
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

describe('POST /routing/message → workspace task (ported from /routing/delegate)', () => {
  it('enqueues the task on the durable queue and returns immediately', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parentSessionId = await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'summarize the docs',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; jobId: string; deliveredTo: string }
      expect(body.status).toBe('enqueued')
      expect(body.deliveredTo).toBe('Acme')

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
        '/routing/message',
        { to: `workspace:${workspace.id}`, body: 'summarize' },
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
        '/routing/message',
        { to: `workspace:${workspace.id}`, body: 'summarize' },
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
        '/routing/message',
        { to: `workspace:${workspace.id}`, body: 'summarize' },
        { [DELEGATION_MODE_HEADER]: 'yolo' },
      )
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }
      expect(findDelegationJobById(db, jobId)?.permissionMode).toBeNull()
    })
  })

  it('threads the model + thinkingEffort picks onto the job; 400s a model outside the allowlist', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'routine tidy-up',
        model: 'claude-haiku-4-5',
        thinkingEffort: 'low',
      })
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }
      const job = findDelegationJobById(db, jobId)
      expect(job?.model).toBe('claude-haiku-4-5')
      expect(job?.thinkingEffort).toBe('low')

      // Only the curated allowlist passes (the composer precedent) — and an
      // invalid effort level is equally rejected at the boundary.
      const badModel = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 't',
        model: 'gpt-5',
      })
      expect(badModel.status).toBe(400)
      const badEffort = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 't',
        thinkingEffort: 'ultra',
      })
      expect(badEffort.status).toBe(400)

      // The session route composes the SAME shared preference fields — pin it
      // (validation runs before target resolution, so no spawned seed needed).
      const badSessionModel = await postJson(app, '/routing/message', {
        to: `session:${'any'}`,
        body: 't',
        model: 'gpt-5',
      })
      expect(badSessionModel.status).toBe(400)
    })
  })

  it('400s when there is no active global-root turn', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'summarize',
      })
      expect(res.status).toBe(400)
    })
  })

  it('404s on an unknown target workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${randomUUID()}`,
        body: 'summarize',
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

describe('POST /routing/reply-to-channel (the channel pipeline, 2026-07-27)', () => {
  it('delivers to the server-stamped origin — the model passes ONLY its answer', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const app = makeHarness(db)

      const origin = {
        channelId: channel.id,
        externalSenderId: 'tg-42',
        externalChatContextId: '-100777',
        externalMessageId: 'msg-9',
      }
      const res = await postJson(
        app,
        '/routing/reply-to-channel',
        { message: 'Pricing went up 4%.' },
        { [DELEGATION_ORIGIN_HEADER]: serializeDelegationOrigin(origin) },
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'sent', deliveredTo: channel.displayName })

      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        externalRecipientId: 'tg-42',
        externalChatContextId: '-100777',
        messageBody: 'Pricing went up 4%.',
        payloadKind: 'chat-stream-final',
      })
      // The group reply threads onto the asking message — from the origin,
      // never from model input.
      expect(JSON.parse(queued[0]!.messageStructure)).toEqual({
        replyToExternalMessageId: 'msg-9',
      })
    })
  })

  it('400s with an actionable message when the turn has no channel origin', async () => {
    await withTestDatabase(async (db) => {
      seedChannelWithAllowedSender(db)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/reply-to-channel', { message: 'hello' })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('did not arrive via a channel')
    })
  })
})

describe('POST /routing/message → session task (ported from /routing/delegate-session, Slice ④)', () => {
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

        const res = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 'compare pricing',
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { status: string; jobId: string; deliveredTo: string }
        expect(body.status).toBe('enqueued')
        expect(body.deliveredTo).toBe('Research: pricing')

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

  it('threads the model + thinkingEffort picks onto the SESSION-target job', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-picks-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        await seedLinkedGlobalRoot(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id)
        const app = makeHarness(db)

        const res = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 'hard analysis',
          model: 'claude-sonnet-4-6',
          thinkingEffort: 'max',
        })
        expect(res.status).toBe(200)
        const { jobId } = (await res.json()) as { jobId: string }
        const job = findDelegationJobById(db, jobId)
        expect(job?.model).toBe('claude-sonnet-4-6')
        expect(job?.thinkingEffort).toBe('max')
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

        const res = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 'dig into the backlog',
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

        // OWN-CHILD RULE (Kafi, 2026-08-17 — flips the earlier "cwd follows the
        // target" pin): a GLOBAL-grounded session is the root's own child, so a
        // workspace tasking it is a 400, never a cross-parent delivery.
        const globalSpawned = await seedSpawnedSession(db, user.id, 'sdk-sp-global')
        const res2 = await postJson(app, '/routing/message', {
          to: `session:${globalSpawned.sessionId}`,
          body: 't',
          workspaceId: workspace.id,
        })
        expect(res2.status).toBe(400)
        expect(await res2.text()).toContain('global assistant')
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

        const res = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 't',
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

        const unknown = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 't',
          workspaceId: randomUUID(),
        })
        expect(unknown.status).toBe(404)

        // Not-owned answers exactly like unknown (no enumeration leak).
        const crossUser = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 't',
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
        const noRoot = await postJson(app, '/routing/message', {
          to: `session:${spawned.sessionId}`,
          body: 't',
        })
        expect(noRoot.status).toBe(400)

        await seedLinkedGlobalRoot(db, user.id)
        // Unknown handle → 404.
        const unknown = await postJson(app, '/routing/message', {
          to: `session:${'sdk-no-such'}`,
          body: 't',
        })
        expect(unknown.status).toBe(404)

        // Another user's spawned session → the same 404 (no enumeration leak).
        const stranger = seedUser(db)
        const theirs = await seedSpawnedSession(db, stranger.id, 'sdk-sp-theirs')
        const crossUser = await postJson(app, '/routing/message', {
          to: `session:${theirs.sessionId}`,
          body: 't',
        })
        expect(crossUser.status).toBe(404)
      })
    })
  })
})

describe('POST /routing/message → requester report (ported from /routing/report, session-comms)', () => {
  // The spawn-time priming turn, faked (session-started + completed) — a local
  // copy of the delegate-session describe's helper (describe-scoped there).
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

  function postReport(app: ReturnType<typeof makeHarness>, report: string, caller?: ReportCaller) {
    return postJson(
      app,
      '/routing/message',
      { to: 'requester', body: report },
      caller !== undefined ? { [REPORT_CALLER_HEADER]: serializeReportCaller(caller) } : {},
    )
  }

  it('400s without the caller-identity header — interactive chats, schedule fires, and the global root have no requester', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await postReport(app, 'my findings')
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain('no requester')
    })
  })

  it('a WORKSPACE-PRIMARY caller reports to the GLOBAL root: kind report-delivery, both targets null, manager label, reporter provenance', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-r1')
      const app = makeHarness(db)

      const res = await postReport(app, 'All docs are current.', {
        kind: 'workspace-primary',
        workspaceId: workspace.id,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; jobId: string }
      expect(body.status).toBe('enqueued')

      const job = findDelegationJobById(db, body.jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBeNull()
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.taskText).toBe('All docs are current.')
      expect(job?.workspaceName).toBe('Mark · Acme')
      expect(job?.parentSessionId).toBe('ws-primary-r1')
    })
  })

  it('the requester-override header (chat-mentions) reroutes a WORKSPACE caller to the ORIGINATING workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const target = seedManagedWorkspace(db, user.id, 'Target')
      const origin = seedManagedWorkspace(db, user.id, 'Origin')
      await seedLinkedWorkspacePrimaryFor(db, user.id, target.id, 'ws-target-r1')
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/message',
        { to: 'requester', body: 'Launch is on track.'  },
        {
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'workspace-primary',
            workspaceId: target.id,
          }),
          [REPORT_REQUESTER_HEADER]: origin.id,
        },
      )
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }

      // The delivery targets the ORIGINATING workspace's primary, not the root.
      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(origin.id)
      expect(job?.workspacePath).toBe(origin.path)
      expect(job?.workspaceName).toBe('Mark · Target') // still labeled FROM the reporter
    })
  })

  it('a foreign or self requester-override falls back to the global root', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const target = seedManagedWorkspace(db, user.id, 'Target')
      await seedLinkedWorkspacePrimaryFor(db, user.id, target.id, 'ws-target-r2')
      const stranger = seedUser(db)
      const foreign = seedManagedWorkspace(db, stranger.id, 'Foreign')
      const app = makeHarness(db)

      for (const overrideId of [foreign.id, target.id]) {
        const res = await postJson(
          app,
          '/routing/message',
          { to: 'requester', body: 'r'  },
          {
            [REPORT_CALLER_HEADER]: serializeReportCaller({
              kind: 'workspace-primary',
              workspaceId: target.id,
            }),
            [REPORT_REQUESTER_HEADER]: overrideId,
          },
        )
        expect(res.status).toBe(200)
        const { jobId } = (await res.json()) as { jobId: string }
        const job = findDelegationJobById(db, jobId)
        expect(job?.workspaceId).toBeNull() // global root — never a foreign/self reroute
      }
    })
  })

  it('a GLOBAL-grounded SPAWNED caller reports to the GLOBAL root, labeled as the session', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const spawned = await createSpawnedSession(db, makePrimingProvider('sdk-sp-report-1'), {
        userId: user.id,
        name: 'Research: pricing',
        purpose: 'compare pricing pages',
        workspacePath: '/tmp/vynel/global-root',
      })
      const app = makeHarness(db)

      const res = await postReport(app, 'A undercuts us by 12%.', {
        kind: 'spawned-session',
        targetPrimarySessionId: spawned.primarySessionId,
      })
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBeNull()
      expect(job?.workspaceName).toBe('Research: pricing')
      expect(job?.parentSessionId).toBe('sdk-sp-report-1')
    })
  })

  it('a WORKSPACE-grounded SPAWNED caller reports to ITS workspace primary (the creator), run cwd = that workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      const spawned = await createSpawnedSession(db, makePrimingProvider('sdk-sp-report-2'), {
        userId: user.id,
        name: 'Acme research',
        purpose: 'dig into the backlog',
        workspacePath: workspace.path,
        workspaceId: workspace.id,
      })
      const app = makeHarness(db)

      const res = await postReport(app, 'Backlog has 4 stale items.', {
        kind: 'spawned-session',
        targetPrimarySessionId: spawned.primarySessionId,
      })
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.workspaceName).toBe('Acme research')
      expect(job?.parentSessionId).toBe('sdk-sp-report-2')
    })
  })

  it('404s an unknown or foreign spawned caller (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)
      const unknown = await postReport(app, 'r', {
        kind: 'spawned-session',
        targetPrimarySessionId: randomUUID(),
      })
      expect(unknown.status).toBe(404)

      const stranger = seedUser(db)
      const theirs = await createSpawnedSession(db, makePrimingProvider('sdk-sp-theirs-r'), {
        userId: stranger.id,
        name: 'S',
        purpose: 'p',
        workspacePath: '/tmp/x',
      })
      const crossUser = await postReport(app, 'r', {
        kind: 'spawned-session',
        targetPrimarySessionId: theirs.primarySessionId,
      })
      expect(crossUser.status).toBe(404)
      // The seeded first user stays the resolved local user.
      expect(user.id).not.toBe(stranger.id)
    })
  })

  it('enforces the report bounds at the boundary (empty and over-long both 400)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-r2')
      const app = makeHarness(db)
      const caller: ReportCaller = { kind: 'workspace-primary', workspaceId: workspace.id }

      expect((await postReport(app, '', caller)).status).toBe(400)
      expect((await postReport(app, 'x'.repeat(50001), caller)).status).toBe(400)
    })
  })

  it('400s a workspace caller whose primary conversation has no linked session (never forge provenance)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      const app = makeHarness(db)
      const res = await postReport(app, 'r', {
        kind: 'workspace-primary',
        workspaceId: workspace.id,
      })
      expect(res.status).toBe(400)
    })
  })

  it('an AGENT-SESSION caller reports to its grounding workspace primary, labeled by the agent name', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      const { colleagueId, sdkSessionId } = await seedLinkedColleague(db, user.id, {
        workspaceId: workspace.id,
        slug: 'researcher',
        name: 'Nova',
      })
      const app = makeHarness(db)

      const res = await postReport(app, 'Found three strong sources.', {
        kind: 'agent-session',
        targetPrimarySessionId: colleagueId,
      })
      expect(res.status).toBe(200)
      const { jobId } = (await res.json()) as { jobId: string }

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.workspaceName).toBe('Nova')
      expect(job?.parentSessionId).toBe(sdkSessionId)
    })
  })

  it('an AGENT-SESSION caller honors the requester-override; a GLOBAL colleague falls to the root', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const grounding = seedManagedWorkspace(db, user.id, 'Grounding')
      const origin = seedManagedWorkspace(db, user.id, 'Origin')
      const grounded = await seedLinkedColleague(db, user.id, {
        workspaceId: grounding.id,
        slug: 'researcher',
        name: 'Nova',
      })
      const app = makeHarness(db)

      // Override wins over the grounding workspace (the mention's origin chat).
      const overridden = await app.request('/routing/message', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'agent-session',
            targetPrimarySessionId: grounded.colleagueId,
          }),
          [REPORT_REQUESTER_HEADER]: origin.id,
        },
        body: JSON.stringify({ to: 'requester', body: 'On it.'  }),
      })
      expect(overridden.status).toBe(200)
      const overriddenJob = findDelegationJobById(
        db,
        ((await overridden.json()) as { jobId: string }).jobId,
      )
      expect(overriddenJob?.workspaceId).toBe(origin.id)

      // A GLOBAL colleague with no override reports to the global root.
      const globalColleague = await seedLinkedColleague(db, user.id, {
        workspaceId: null,
        slug: 'writer',
        name: 'Quill',
      })
      const global = await postReport(app, 'Draft ready.', {
        kind: 'agent-session',
        targetPrimarySessionId: globalColleague.colleagueId,
      })
      expect(global.status).toBe(200)
      const globalJob = findDelegationJobById(
        db,
        ((await global.json()) as { jobId: string }).jobId,
      )
      expect(globalJob?.workspaceId).toBeNull()
      expect(globalJob?.targetPrimarySessionId).toBeNull()
      expect(globalJob?.workspaceName).toBe('Quill')
    })
  })

  it('404s an unknown or foreign agent-session caller (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)
      expect(
        (
          await postReport(app, 'r', {
            kind: 'agent-session',
            targetPrimarySessionId: randomUUID(),
          })
        ).status,
      ).toBe(404)

      const stranger = seedUser(db)
      const theirs = await seedLinkedColleague(db, stranger.id, {
        workspaceId: null,
        slug: 'researcher',
        name: 'Nova',
      })
      expect(
        (
          await postReport(app, 'r', {
            kind: 'agent-session',
            targetPrimarySessionId: theirs.colleagueId,
          })
        ).status,
      ).toBe(404)
      expect(user.id).not.toBe(stranger.id)
    })
  })

  // `deliveredTo` is the sender's ONLY confirmation of where its message went,
  // and every upward branch resolves it separately — so every branch is pinned
  // here. The spawned case regressed silently precisely because no upward path
  // asserted this field: the destination fell back to the SENDER's own label,
  // which reads as a successful delivery to itself.
  describe('deliveredTo names the DESTINATION, never the sender', () => {
    it('a WORKSPACE-grounded spawned session names the workspace, not itself', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedManagedWorkspace(db, user.id)
        const spawned = await createSpawnedSession(db, makePrimingProvider('sdk-sp-dt-1'), {
          userId: user.id,
          name: 'Acme research',
          purpose: 'dig into the backlog',
          workspacePath: workspace.path,
          workspaceId: workspace.id,
        })
        const app = makeHarness(db)
        const caller: ReportCaller = {
          kind: 'spawned-session',
          targetPrimarySessionId: spawned.primarySessionId,
        }

        // 'Acme' — where it went. NEVER 'Acme research', which is who sent it.
        const report = await postReport(app, 'Backlog has 4 stale items.', caller)
        expect(report.status).toBe(200)
        expect(((await report.json()) as { deliveredTo: string }).deliveredTo).toBe('Acme')

        // All three upward dispatchers share one resolution — an update agrees.
        const update = await postJson(
          app,
          '/routing/message',
          { to: 'requester', body: 'Received — starting now.', kind: 'update' },
          { [REPORT_CALLER_HEADER]: serializeReportCaller(caller) },
        )
        expect(update.status).toBe(200)
        expect(((await update.json()) as { deliveredTo: string }).deliveredTo).toBe('Acme')
      })
    })

    it('a GLOBAL-grounded spawned session names Global', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const spawned = await createSpawnedSession(db, makePrimingProvider('sdk-sp-dt-2'), {
          userId: user.id,
          name: 'Research: pricing',
          purpose: 'compare pricing pages',
          workspacePath: '/tmp/vynel/global-root',
        })
        const app = makeHarness(db)

        const res = await postReport(app, 'A undercuts us by 12%.', {
          kind: 'spawned-session',
          targetPrimarySessionId: spawned.primarySessionId,
        })
        expect(res.status).toBe(200)
        expect(((await res.json()) as { deliveredTo: string }).deliveredTo).toBe('Global')
      })
    })

    it('a workspace primary names Global, or the ORIGINATING workspace when rerouted', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const target = seedManagedWorkspace(db, user.id, 'Target')
        const origin = seedManagedWorkspace(db, user.id, 'Origin')
        await seedLinkedWorkspacePrimaryFor(db, user.id, target.id, 'ws-primary-dt3')
        const app = makeHarness(db)
        const caller: ReportCaller = { kind: 'workspace-primary', workspaceId: target.id }

        const plain = await postReport(app, 'All docs are current.', caller)
        expect(plain.status).toBe(200)
        expect(((await plain.json()) as { deliveredTo: string }).deliveredTo).toBe('Global')

        // The mention reroute — and a direct_to_user rides the same resolution,
        // so this pins the third dispatcher too.
        const rerouted = await postJson(
          app,
          '/routing/message',
          { to: 'requester', body: 'Full overview.', kind: 'direct_to_user', title: 'Overview' },
          {
            [REPORT_CALLER_HEADER]: serializeReportCaller(caller),
            [REPORT_REQUESTER_HEADER]: origin.id,
          },
        )
        expect(rerouted.status).toBe(200)
        expect(((await rerouted.json()) as { deliveredTo: string }).deliveredTo).toBe('Origin')
      })
    })

    it('an agent colleague names the workspace it lands in, not the agent', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedManagedWorkspace(db, user.id, 'Grounding')
        const { colleagueId } = await seedLinkedColleague(db, user.id, {
          workspaceId: workspace.id,
          slug: 'researcher',
          name: 'Nova',
        })
        const app = makeHarness(db)

        const res = await postReport(app, 'Found three strong sources.', {
          kind: 'agent-session',
          targetPrimarySessionId: colleagueId,
        })
        expect(res.status).toBe(200)
        expect(((await res.json()) as { deliveredTo: string }).deliveredTo).toBe('Grounding')
      })
    })
  })
})

describe('POST /routing/message → kind direct_to_user (direct messages to the user)', () => {
  it('enqueues a direct-delivery row — the title leads the body, the kind is echoed', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-dm1')
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/message',
        {
          to: 'requester',
          body: 'Full overview text.',
          kind: 'direct_to_user',
          title: 'Overview of the agency app',
        },
        {
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'workspace-primary',
            workspaceId: workspace.id,
          }),
        },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; jobId: string; kind: string }
      expect(body.status).toBe('enqueued')
      expect(body.kind).toBe('direct_to_user')

      const job = findDelegationJobById(db, body.jobId)
      expect(job?.jobKind).toBe('direct-delivery')
      expect(job?.taskText).toBe('Overview of the agency app\n\nFull overview text.')
      expect(job?.workspaceName).toBe('Mark · Acme')
      expect(job?.parentSessionId).toBe('ws-primary-dm1')
    })
  })

  it('400s a direct_to_user without a title, a title on any other kind, and a downward direct', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-dm2')
      const app = makeHarness(db)
      const callerHeader = {
        [REPORT_CALLER_HEADER]: serializeReportCaller({
          kind: 'workspace-primary',
          workspaceId: workspace.id,
        }),
      }

      const noTitle = await postJson(
        app,
        '/routing/message',
        { to: 'requester', body: 'x', kind: 'direct_to_user' },
        callerHeader,
      )
      expect(noTitle.status).toBe(400)
      expect(((await noTitle.json()) as { message: string }).message).toContain('title')

      const titleOnReport = await postJson(
        app,
        '/routing/message',
        { to: 'requester', body: 'x', kind: 'report', title: 'T' },
        callerHeader,
      )
      expect(titleOnReport.status).toBe(400)

      const directDown = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'x',
        kind: 'direct_to_user',
        title: 'T',
      })
      expect(directDown.status).toBe(400)
    })
  })
})

describe('GET /routing/delegated-tasks (reading back a handed-off task)', () => {
  it('lists a delegated task as a run the agent can read, keyed by the jobId it was given', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      // Hand work off exactly as the agent does — the jobId in this response is
      // the handle that used to lead nowhere.
      const delegated = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'summarize the docs',
      })
      const { jobId } = (await delegated.json()) as { jobId: string }

      const res = await app.request('/routing/delegated-tasks')
      expect(res.status).toBe(200)
      const runs = (await res.json()) as { jobId: string; status: string; target: string }[]
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ jobId, status: 'queued', target: 'Acme' })
    })
  })

  it('serves one run by jobId with the task as handed off', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const delegated = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'summarize the docs',
      })
      const { jobId } = (await delegated.json()) as { jobId: string }

      const res = await app.request(`/routing/delegated-tasks/${jobId}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        jobId,
        status: 'queued',
        taskText: 'summarize the docs',
        result: null,
      })
    })
  })

  // An unknown id must 404 rather than 500 or leak. The OTHER half of this rule
  // — that a run owned by someone else is indistinguishable from an unknown one
  // — is pinned a layer down in `list-delegated-tasks.test.ts`, where a second
  // user's job can be seeded directly (this harness resolves one local user, and
  // widening the package's public API to seed one here isn't worth it).
  it('404s an unknown run', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await app.request(`/routing/delegated-tasks/${randomUUID()}`)
      expect(res.status).toBe(404)
    })
  })
})

describe('POST /routing/message (send_message — the unified comms tool)', () => {
  it('routes "workspace:<id>" as a task down, identically to the old delegate route', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parentSessionId = await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'summarize the docs',
      })
      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; deliveredTo: string; kind: string }
      expect(out).toMatchObject({ deliveredTo: 'Acme', kind: 'task' })

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.taskText).toBe('summarize the docs')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.parentSessionId).toBe(parentSessionId)
      // A first hop seeds its own chain.
      expect(job?.threadId).toBe(job?.partialSessionId)
    })
  })

  // The destination is the model's choice; WHO asked never is. A turn with no
  // caller identity has no requester, and that must be an actionable 400 rather
  // than a message delivered somewhere plausible.
  it('400s "requester" on a turn that has no requester', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: 'requester',
        body: 'here are the findings',
      })
      expect(res.status).toBe(400)
    })
  })

  it('reports up to the global root when the caller is a workspace primary', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-msg')
      const app = makeHarness(db)

      const res = await app.request('/routing/message', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'workspace-primary',
            workspaceId: workspace.id,
          }),
        },
        body: JSON.stringify({ to: 'requester', body: '12 docs, 3 stale' }),
      })

      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; kind: string }
      expect(out.kind).toBe('report')
      const job = findDelegationJobById(db, out.jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.taskText).toBe('12 docs, 3 stale')
    })
  })

  it('routes "session:<id>" to an agent COLLEAGUE segment (persona-sessions)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      const { colleagueId, sdkSessionId } = await seedLinkedColleague(db, user.id, {
        workspaceId: null,
        slug: 'researcher',
        name: 'Nova',
      })
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `session:${sdkSessionId}`,
        body: 'dig into WAL mode',
      })
      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; deliveredTo: string; kind: string }
      expect(out).toMatchObject({ deliveredTo: 'Nova', kind: 'task' })

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.targetPrimarySessionId).toBe(colleagueId)
      expect(job?.taskText).toBe('dig into WAL mode')
    })
  })

  it('kind "update" enqueues an update-delivery row and NEVER marks the running job reported', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-upd')
      // The running task this turn is working on (the job header names it).
      const runningJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'the task being acked',
      })
      const app = makeHarness(db)

      const send = (kind: 'update' | 'report', body: string) =>
        app.request('/routing/message', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [REPORT_CALLER_HEADER]: serializeReportCaller({
              kind: 'workspace-primary',
              workspaceId: workspace.id,
            }),
            [DELEGATION_JOB_HEADER]: runningJobId,
          },
          body: JSON.stringify({ to: 'requester', body, kind }),
        })

      const ackRes = await send('update', 'Received — starting now.')
      expect(ackRes.status).toBe(200)
      const ack = (await ackRes.json()) as { jobId: string; kind: string }
      expect(ack.kind).toBe('update')
      const ackJob = findDelegationJobById(db, ack.jobId)
      expect(ackJob?.jobKind).toBe('update-delivery')
      // The ack did NOT mark the task reported — only the final report does.
      expect(findDelegationJobById(db, runningJobId)?.reportedAt).toBeNull()

      const reportRes = await send('report', 'Done: 3 files changed.')
      expect(reportRes.status).toBe(200)
      const report = (await reportRes.json()) as { jobId: string; kind: string }
      expect(report.kind).toBe('report')
      expect(findDelegationJobById(db, report.jobId)?.jobKind).toBe('report-delivery')
      expect(findDelegationJobById(db, runningJobId)?.reportedAt).not.toBeNull()
    })
  })

  // Channel report protocol (Kafi 2026-08-22): the report about channel-driven
  // work carries the CHANNEL's origin, so the requester's notify turn can
  // answer the person still waiting there. Read off the running JOB row, never
  // a header: the report travels about the job, not about this turn's inbound.
  describe('a report about CHANNEL-driven work carries its origin', () => {
    const seedChannelOriginJob = (db: Database, userId: string, workspace: { id: string; path: string; name: string }) => {
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId,
        workspaceId: null,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      const runningJobId = enqueueWorkspaceDelegation(db, {
        userId,
        parentSessionId: 'g-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'the channel-driven task',
        origin: {
          channelId: channel.id,
          externalSenderId: 'tg-42',
          externalChatContextId: 'chat-7',
        },
      })
      return { channel, runningJobId }
    }

    it('stamps the origin columns onto the report-delivery row', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedManagedWorkspace(db, user.id)
        await seedLinkedGlobalRoot(db, user.id)
        await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-chan')
        const { channel, runningJobId } = seedChannelOriginJob(db, user.id, workspace)
        const app = makeHarness(db)

        const res = await app.request('/routing/message', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [REPORT_CALLER_HEADER]: serializeReportCaller({
              kind: 'workspace-primary',
              workspaceId: workspace.id,
            }),
            [DELEGATION_JOB_HEADER]: runningJobId,
          },
          body: JSON.stringify({ to: 'requester', body: 'Done: 3 files changed.', kind: 'report' }),
        })
        expect(res.status).toBe(200)
        const { jobId } = (await res.json()) as { jobId: string }
        expect(findDelegationJobById(db, jobId)).toMatchObject({
          jobKind: 'report-delivery',
          originChannelId: channel.id,
          originExternalSenderId: 'tg-42',
          originExternalChatContextId: 'chat-7',
        })
      })
    })

    it('reroutes a direct_to_user OFF the direct path — the direct path runs no turn, so nobody would answer the channel', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedManagedWorkspace(db, user.id)
        await seedLinkedGlobalRoot(db, user.id)
        await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-chan2')
        const { channel, runningJobId } = seedChannelOriginJob(db, user.id, workspace)
        const app = makeHarness(db)

        const res = await app.request('/routing/message', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [REPORT_CALLER_HEADER]: serializeReportCaller({
              kind: 'workspace-primary',
              workspaceId: workspace.id,
            }),
            [DELEGATION_JOB_HEADER]: runningJobId,
          },
          body: JSON.stringify({
            to: 'requester',
            body: 'Full overview text.',
            kind: 'direct_to_user',
            title: 'Overview',
          }),
        })
        expect(res.status).toBe(200)
        const { jobId } = (await res.json()) as { jobId: string }
        // The answer still reaches the user — as a REPORT, through a requester
        // turn that can also reply to Telegram.
        expect(findDelegationJobById(db, jobId)).toMatchObject({
          jobKind: 'report-delivery',
          originChannelId: channel.id,
        })
        expect(findDelegationJobById(db, jobId)?.taskText).toBe(
          `Overview

Full overview text.`,
        )
      })
    })
  })

  it('400s a kind that contradicts the destination — never a silent misroute', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      expect(
        (
          await postJson(app, '/routing/message', {
            to: 'requester',
            body: 'x',
            kind: 'task',
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await postJson(app, '/routing/message', {
            to: `workspace:${workspace.id}`,
            body: 'x',
            kind: 'update',
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await postJson(app, '/routing/message', {
            to: `workspace:${workspace.id}`,
            body: 'x',
            kind: 'report',
          })
        ).status,
      ).toBe(400)
    })
  })

  it('rejects a destination it cannot route', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedWorkspace(db, user.id)
      const app = makeHarness(db)

      expect((await postJson(app, '/routing/message', { to: 'nonsense', body: 'x' })).status).toBe(
        400,
      )
      expect((await postJson(app, '/routing/message', { to: 'requester', body: '' })).status).toBe(
        400,
      )
    })
  })
})

describe('tool-first reporting (no double report)', () => {
  // A turn that reports through the tool has already said what it meant to say.
  // The tick must NOT also harvest its chat reply — that would wake the
  // requester twice, and the harvested copy is the chattier of the two.
  it('marks the running job reported so the tick skips the harvest', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-dbl')
      const app = makeHarness(db)

      // A queue row standing in for the turn that is running right now.
      const runningJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'count the docs',
      })
      expect(findDelegationJobById(db, runningJobId)?.reportedAt ?? null).toBeNull()

      const res = await app.request('/routing/message', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'workspace-primary',
            workspaceId: workspace.id,
          }),
          [DELEGATION_JOB_HEADER]: runningJobId,
        },
        body: JSON.stringify({ to: 'requester', body: '12 docs, 3 stale' }),
      })

      expect(res.status).toBe(200)
      expect(findDelegationJobById(db, runningJobId)?.reportedAt).not.toBeNull()
    })
  })

  // No header = not a delegated turn, so there is no row to mark. Must not throw.
  it('reports fine on a turn with no job header', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, workspace.id, 'ws-primary-nohdr')
      const app = makeHarness(db)

      const res = await app.request('/routing/message', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'workspace-primary',
            workspaceId: workspace.id,
          }),
        },
        body: JSON.stringify({ to: 'requester', body: 'findings' }),
      })
      expect(res.status).toBe(200)
    })
  })
})

// Reports travel to whoever ASKED — one rule for every caller kind (Chad,
// 2026-08-16). Before this, "who asked" was never recorded on a task send: a
// workspace-to-workspace task parented on the GLOBAL root and both the ack and
// the result landed in the global conversation, and a workspace-tasked session
// reported to its own grounding instead of the workspace that asked.
describe('POST /routing/message → a task records WHO asked', () => {
  function primer(sessionId: string): AiAgentProvider {
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

  // The tick stamps the job's requesterWorkspaceId as this header on the routed
  // turn (pinned in run-delegation-claim-and-run-tick.test.ts); passing it here
  // is that hop, simulated.
  function speakUp(
    app: ReturnType<typeof makeHarness>,
    caller: ReportCaller,
    kind: 'update' | 'report',
    requesterOverrideId?: string,
  ) {
    return postJson(
      app,
      '/routing/message',
      { to: 'requester', body: 'x', kind },
      {
        [REPORT_CALLER_HEADER]: serializeReportCaller(caller),
        ...(requesterOverrideId !== undefined
          ? { [REPORT_REQUESTER_HEADER]: requesterOverrideId }
          : {}),
      },
    )
  }

  it('workspace → workspace: parents on the ASKING workspace and reports back to it', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const alpha = seedManagedWorkspace(db, user.id, 'Alpha')
      const beta = seedManagedWorkspace(db, user.id, 'Beta')
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, alpha.id, 'ws-alpha')
      await seedLinkedWorkspacePrimaryFor(db, user.id, beta.id, 'ws-beta')
      const app = makeHarness(db)

      const task = await postJson(app, '/routing/message', {
        to: `workspace:${beta.id}`,
        body: 'audit the invoices',
        workspaceId: alpha.id,
      })
      expect(task.status).toBe(200)
      const taskJob = findDelegationJobById(db, ((await task.json()) as { jobId: string }).jobId)
      // NOT 'g-1': the asking workspace is the provenance parent AND the requester.
      expect(taskJob?.parentSessionId).toBe('ws-alpha')
      expect(taskJob?.requesterWorkspaceId).toBe(alpha.id)

      // Beta's ack and its result both land in Alpha's chat, not the root's.
      const caller: ReportCaller = { kind: 'workspace-primary', workspaceId: beta.id }
      for (const kind of ['update', 'report'] as const) {
        const res = await speakUp(app, caller, kind, alpha.id)
        expect(res.status).toBe(200)
        const out = (await res.json()) as { deliveredTo: string; jobId: string }
        expect(out.deliveredTo).toBe('Alpha')
        expect(findDelegationJobById(db, out.jobId)?.workspaceId).toBe(alpha.id)
      }
    })
  })

  // OWN-CHILD RULE (Kafi, 2026-08-17 — flips the earlier "workspace → a
  // GLOBAL-grounded session" pin): tasks only travel to a caller's OWN
  // sessions; anything else routes through the owning manager. The upward
  // half that pin also carried (a global-grounded spawned caller reporting to
  // the override workspace) survives below, header-driven — the requester
  // rule itself is unchanged.
  it('a task to a session the caller does not parent is an actionable 400', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedManagedWorkspace(db, user.id, 'Home')
      const other = seedManagedWorkspace(db, user.id, 'Other')
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, home.id, 'ws-home')
      const globalSpawned = await createSpawnedSession(db, primer('sdk-ground'), {
        userId: user.id,
        name: 'Research: pricing',
        purpose: 'compare pricing pages',
        workspacePath: '/tmp/vynel/global-root',
      })
      const otherSpawned = await createSpawnedSession(db, primer('sdk-ground-other'), {
        userId: user.id,
        name: 'Backlog digger',
        purpose: 'dig the backlog',
        workspacePath: other.path,
        workspaceId: other.id,
      })
      const app = makeHarness(db)

      // A workspace tasking the root's own session → blocked.
      const wsToGlobal = await postJson(app, '/routing/message', {
        to: `session:${globalSpawned.sessionId}`,
        body: 'compare pricing',
        workspaceId: home.id,
      })
      expect(wsToGlobal.status).toBe(400)
      expect(await wsToGlobal.text()).toContain('global assistant')

      // A workspace tasking ANOTHER workspace's session → blocked, and the
      // error teaches the route: hand it to the owning workspace instead.
      const wsToOther = await postJson(app, '/routing/message', {
        to: `session:${otherSpawned.sessionId}`,
        body: 'dig',
        workspaceId: home.id,
      })
      expect(wsToOther.status).toBe(400)
      const wsToOtherText = await wsToOther.text()
      expect(wsToOtherText).toContain('Other')
      expect(wsToOtherText).toContain(`workspace:${other.id}`)

      // The GLOBAL root tasking a workspace's session → blocked the same way
      // (this is what made the followup's bug 3 reachable).
      const rootToOther = await postJson(app, '/routing/message', {
        to: `session:${otherSpawned.sessionId}`,
        body: 'dig',
      })
      expect(rootToOther.status).toBe(400)
      expect(await rootToOther.text()).toContain(`workspace:${other.id}`)
    })
  })

  it('a GLOBAL-grounded spawned caller with a requester override reports to the override workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedManagedWorkspace(db, user.id, 'Home')
      await seedLinkedWorkspacePrimaryFor(db, user.id, home.id, 'ws-home')
      const spawned = await createSpawnedSession(db, primer('sdk-ground'), {
        userId: user.id,
        name: 'Research: pricing',
        purpose: 'compare pricing pages',
        workspacePath: '/tmp/vynel/global-root',
      })
      const app = makeHarness(db)

      // The session is grounded in NO workspace — before the requester rule,
      // that alone sent its result to the global root and Home never heard back.
      const res = await speakUp(
        app,
        { kind: 'spawned-session', targetPrimarySessionId: spawned.primarySessionId },
        'report',
        home.id,
      )
      expect(res.status).toBe(200)
      const out = (await res.json()) as { deliveredTo: string; jobId: string }
      expect(out.deliveredTo).toBe('Home')
      expect(findDelegationJobById(db, out.jobId)?.workspaceId).toBe(home.id)
    })
  })

  // The calling-workspace guards now fire on the `to: "workspace:"` branch too
  // (both destinations share resolveTaskSender). The session branch pinned these
  // already; the workspace branch reached them with no coverage at all.
  it('404s a workspace task whose CALLING workspace is unknown or not owned', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const beta = seedManagedWorkspace(db, user.id, 'Beta')
      await seedLinkedGlobalRoot(db, user.id)
      const stranger = seedUser(db)
      const foreign = seedManagedWorkspace(db, stranger.id, 'Theirs')
      const app = makeHarness(db)

      for (const callingWorkspaceId of [randomUUID(), foreign.id]) {
        const res = await postJson(app, '/routing/message', {
          to: `workspace:${beta.id}`,
          body: 'audit the invoices',
          workspaceId: callingWorkspaceId,
        })
        // Unknown and not-owned answer identically — no enumeration leak.
        expect(res.status).toBe(404)
      }
    })
  })

  // NOTE: this pins the guard as it stands after the shared-resolver change.
  // Before it, a workspace task ignored the caller entirely and parented on the
  // root, so this call succeeded. Flagged for Chad — if the calling workspace
  // should fall back to the root for PROVENANCE while still being recorded as
  // the requester, this expectation changes with it.
  it('400s a workspace task whose CALLING workspace has no live primary', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const quiet = seedManagedWorkspace(db, user.id, 'Quiet')
      const beta = seedManagedWorkspace(db, user.id, 'Beta')
      await seedLinkedGlobalRoot(db, user.id) // live, but not the caller here
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${beta.id}`,
        body: 'audit the invoices',
        workspaceId: quiet.id,
      })
      expect(res.status).toBe(400)
    })
  })

  it('the global root records NO requester — that is how a chain terminates at the root', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const beta = seedManagedWorkspace(db, user.id, 'Beta')
      await seedLinkedGlobalRoot(db, user.id)
      await seedLinkedWorkspacePrimaryFor(db, user.id, beta.id, 'ws-beta-root')
      const app = makeHarness(db)

      const task = await postJson(app, '/routing/message', {
        to: `workspace:${beta.id}`,
        body: 'audit the invoices',
      })
      expect(task.status).toBe(200)
      const taskJob = findDelegationJobById(db, ((await task.json()) as { jobId: string }).jobId)
      expect(taskJob?.parentSessionId).toBe('g-1')
      expect(taskJob?.requesterWorkspaceId).toBeNull()

      // With nothing recorded, Beta's report terminates at the root as before.
      const res = await speakUp(app, { kind: 'workspace-primary', workspaceId: beta.id }, 'report')
      expect(((await res.json()) as { deliveredTo: string }).deliveredTo).toBe('Global')
    })
  })
})

// The LATERAL kind (session-comms; Kafi, 2026-08-17): kind "note" — plain
// communication to the same downward targets, anyone-to-anyone, tracked by
// nothing. The contrast pins matter most: a note crosses the parent lines the
// own-child TASK rule refuses, precisely because it cannot hand out work.
describe('POST /routing/message → kind "note" (the lateral kind)', () => {
  function primer(sessionId: string): AiAgentProvider {
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

  function seedSpawnedIn(
    db: Database,
    userId: string,
    sdkSessionId: string,
    workspace: { id: string; path: string },
    name = 'Research: pricing',
  ) {
    return createSpawnedSession(db, primer(sdkSessionId), {
      userId,
      name,
      purpose: 'p',
      workspacePath: workspace.path,
      workspaceId: workspace.id,
    })
  }

  it('a note cannot address "requester", and model/effort ride tasks only (both are 400s)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id, 'Home')
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const noteUp = await postJson(app, '/routing/message', {
        to: 'requester',
        body: 'x',
        kind: 'note',
      })
      expect(noteUp.status).toBe(400)
      expect(await noteUp.text()).toContain('note')

      const noteWithModel = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'x',
        kind: 'note',
        model: 'claude-haiku-4-5',
      })
      expect(noteWithModel.status).toBe(400)

      // The recorded sharp edge, closed: an upward send used to accept a legal
      // model and silently drop it — now it is the same loud 400.
      const reportWithModel = await postJson(app, '/routing/message', {
        to: 'requester',
        body: 'x',
        kind: 'report',
        model: 'claude-haiku-4-5',
      })
      expect(reportWithModel.status).toBe(400)
      expect(await reportWithModel.text()).toContain('task')
    })
  })

  it('the GLOBAL root notes a workspace: a kind-"note" row signed Global, nothing tracked', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id, 'Home')
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/message', {
        to: `workspace:${workspace.id}`,
        body: 'Heads up — the user will ask about invoices tomorrow.',
        kind: 'note',
      })
      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; deliveredTo: string; kind: string }
      expect(out.kind).toBe('note')
      expect(out.deliveredTo).toBe('Home')

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.jobKind).toBe('note')
      expect(job?.status).toBe('pending')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.targetPrimarySessionId).toBeNull()
      // The sender rides the reused columns: label, session, workspace (none).
      expect(job?.workspaceName).toBe('Global')
      expect(job?.parentSessionId).toBe('g-1')
      expect(job?.requesterWorkspaceId).toBeNull()
      // The marker is composed at dispatch and leads the stored body.
      expect(job?.taskText.startsWith('[Note from Global')).toBe(true)
      expect(job?.taskText).toContain('invoices tomorrow')
    })
  })

  it("a workspace notes ANOTHER workspace's session — allowed exactly where the task is refused", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedManagedWorkspace(db, user.id, 'Home')
      const other = seedManagedWorkspace(db, user.id, 'Other')
      await seedLinkedWorkspacePrimaryFor(db, user.id, home.id, 'ws-home')
      const spawned = await seedSpawnedIn(db, user.id, 'sdk-note-target', other, 'Backlog digger')
      const app = makeHarness(db)

      const asTask = await postJson(app, '/routing/message', {
        to: `session:${spawned.sessionId}`,
        body: 'dig',
        workspaceId: home.id,
      })
      expect(asTask.status).toBe(400)

      const asNote = await postJson(app, '/routing/message', {
        to: `session:${spawned.sessionId}`,
        body: 'When the backlog pass lands, tell the planner session.',
        kind: 'note',
        workspaceId: home.id,
      })
      expect(asNote.status).toBe(200)
      const out = (await asNote.json()) as { jobId: string; deliveredTo: string }
      expect(out.deliveredTo).toBe('Backlog digger')

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.jobKind).toBe('note')
      expect(job?.targetPrimarySessionId).toBe(spawned.primarySessionId)
      // Run cwd follows the TARGET's grounding.
      expect(job?.workspacePath).toBe(other.path)
      // The sender: the HOME primary, labeled persona-first, replyable by id.
      expect(job?.workspaceName).toBe('Mark · Home')
      expect(job?.parentSessionId).toBe('ws-home')
      expect(job?.requesterWorkspaceId).toBe(home.id)
      expect(job?.taskText).toContain(`workspace:${home.id}`)
    })
  })

  it('a spawned session notes a sibling, signed as ITSELF with a session reply address', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedManagedWorkspace(db, user.id, 'Home')
      const alpha = await seedSpawnedIn(db, user.id, 'sdk-alpha', workspace, 'Alpha helper')
      const beta = await seedSpawnedIn(db, user.id, 'sdk-beta', workspace, 'Beta helper')
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/message',
        {
          to: `session:${beta.sessionId}`,
          body: "When you're done, let me know — I'll start my task.",
          kind: 'note',
          workspaceId: workspace.id,
        },
        {
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'spawned-session',
            targetPrimarySessionId: alpha.primarySessionId,
          }),
        },
      )
      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; deliveredTo: string }
      expect(out.deliveredTo).toBe('Beta helper')

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.jobKind).toBe('note')
      expect(job?.targetPrimarySessionId).toBe(beta.primarySessionId)
      // Signed as the SESSION itself — never as its grounding workspace.
      expect(job?.workspaceName).toBe('Alpha helper')
      expect(job?.parentSessionId).toBe(alpha.sessionId)
      expect(job?.requesterWorkspaceId).toBe(workspace.id)
      expect(job?.taskText).toContain(`session:${alpha.sessionId}`)
    })
  })

  it('self-notes are refused; a session noting its own grounding workspace is not a self-note', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedManagedWorkspace(db, user.id, 'Home')
      await seedLinkedWorkspacePrimaryFor(db, user.id, home.id, 'ws-home')
      const alpha = await seedSpawnedIn(db, user.id, 'sdk-alpha-self', home, 'Alpha helper')
      const app = makeHarness(db)
      const alphaCaller = {
        [REPORT_CALLER_HEADER]: serializeReportCaller({
          kind: 'spawned-session',
          targetPrimarySessionId: alpha.primarySessionId,
        }),
      }

      const sessionSelf = await postJson(
        app,
        '/routing/message',
        { to: `session:${alpha.sessionId}`, body: 'x', kind: 'note', workspaceId: home.id },
        alphaCaller,
      )
      expect(sessionSelf.status).toBe(400)
      expect(await sessionSelf.text()).toContain('itself')

      const workspaceSelf = await postJson(app, '/routing/message', {
        to: `workspace:${home.id}`,
        body: 'x',
        kind: 'note',
        workspaceId: home.id,
      })
      expect(workspaceSelf.status).toBe(400)
      expect(await workspaceSelf.text()).toContain('itself')

      // A session telling its MANAGER something is legitimate coordination.
      const toOwnManager = await postJson(
        app,
        '/routing/message',
        { to: `workspace:${home.id}`, body: 'x', kind: 'note', workspaceId: home.id },
        alphaCaller,
      )
      expect(toOwnManager.status).toBe(200)
      const job = findDelegationJobById(
        db,
        ((await toOwnManager.json()) as { jobId: string }).jobId,
      )
      expect(job?.workspaceName).toBe('Alpha helper')
      expect(job?.workspaceId).toBe(home.id)
    })
  })

  it('unknown and foreign note targets answer the identical 404', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      const stranger = seedUser(db)
      const foreign = seedManagedWorkspace(db, stranger.id, 'Theirs')
      const app = makeHarness(db)

      for (const to of [`workspace:${foreign.id}`, `workspace:${randomUUID()}`, 'session:nope']) {
        const res = await postJson(app, '/routing/message', { to, body: 'x', kind: 'note' })
        expect(res.status).toBe(404)
      }
    })
  })
})

// The GLOBAL note address (voice-session arc): `to:"global"` is the ONE way a
// session speaks INTO the global conversation uninvited — notes only, because
// the global assistant is nobody's child and takes no tasks. The voice thread
// is the address's first citizen: its sends attribute as "Voice" via the
// ambient turn-session header, never model input.
describe('POST /routing/message → to:"global" (the global note address)', () => {
  it('a task cannot address "global" — actionable 400, notes only', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await postJson(app, '/routing/message', {
        to: 'global',
        body: 'do something',
        kind: 'task',
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('note')
    })
  })

  it('the global conversation cannot note itself (self-guard)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)
      const res = await postJson(app, '/routing/message', {
        to: 'global',
        body: 'hello me',
        kind: 'note',
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('itself')
    })
  })

  it('a VOICE turn notes global: both-null note row, signed "Voice" off the ambient turn-session header', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      await seedLinkedGlobalRoot(db, user.id)
      // The spoken thread's running segment — what the turn-session header names.
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'voice-seg-1',
          userId: user.id,
          workspaceId: null,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Voice conversation',
          visibility: 'hidden',
          scope: 'voice',
        }),
      )
      const app = makeHarness(db)

      const res = await postJson(
        app,
        '/routing/message',
        { to: 'global', body: 'The user asked me to flag the deploy window.', kind: 'note' },
        { 'x-vynel-turn-session': 'voice-seg-1' },
      )
      expect(res.status).toBe(200)
      const out = (await res.json()) as { jobId: string; deliveredTo: string; kind: string }
      expect(out.kind).toBe('note')
      expect(out.deliveredTo).toBe('Global')

      const job = findDelegationJobById(db, out.jobId)
      expect(job?.jobKind).toBe('note')
      expect(job?.workspaceId).toBeNull()
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.workspaceName).toBe('Voice')
      expect(job?.parentSessionId).toBe('voice-seg-1')
      expect(job?.taskText.startsWith('[Note from Voice')).toBe(true)
      expect(job?.taskText).toContain('deploy window')
    })
  })
})
