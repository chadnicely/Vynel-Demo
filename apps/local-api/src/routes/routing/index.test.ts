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
import { createAgent } from '@vynel/agents'
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

  it('threads the model + thinkingEffort picks onto the job; 400s a model outside the allowlist', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      const res = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 'routine tidy-up',
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
      const badModel = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 't',
        model: 'gpt-5',
      })
      expect(badModel.status).toBe(400)
      const badEffort = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 't',
        thinkingEffort: 'ultra',
      })
      expect(badEffort.status).toBe(400)

      // The session route composes the SAME shared preference fields — pin it
      // (validation runs before target resolution, so no spawned seed needed).
      const badSessionModel = await postJson(app, '/routing/delegate-session', {
        targetSessionId: 'any',
        task: 't',
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

  it('threads the model + thinkingEffort picks onto the SESSION-target job', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-delegate-picks-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        await seedLinkedGlobalRoot(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id)
        const app = makeHarness(db)

        const res = await postJson(app, '/routing/delegate-session', {
          targetSessionId: spawned.sessionId,
          task: 'hard analysis',
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

describe('POST /routing/report (session-comms — report_to_requester)', () => {
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
      '/routing/report',
      { report },
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
        '/routing/report',
        { report: 'Launch is on track.' },
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
          '/routing/report',
          { report: 'r' },
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
      const overridden = await app.request('/routing/report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [REPORT_CALLER_HEADER]: serializeReportCaller({
            kind: 'agent-session',
            targetPrimarySessionId: grounded.colleagueId,
          }),
          [REPORT_REQUESTER_HEADER]: origin.id,
        },
        body: JSON.stringify({ report: 'On it.' }),
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
})

describe('GET /routing/background-runs (reading back a handed-off task)', () => {
  it('lists a delegated task as a run the agent can read, keyed by the jobId it was given', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      await seedLinkedGlobalRoot(db, user.id)
      const app = makeHarness(db)

      // Hand work off exactly as the agent does — the jobId in this response is
      // the handle that used to lead nowhere.
      const delegated = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 'summarize the docs',
      })
      const { jobId } = (await delegated.json()) as { jobId: string }

      const res = await app.request('/routing/background-runs')
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

      const delegated = await postJson(app, '/routing/delegate', {
        targetWorkspaceId: workspace.id,
        task: 'summarize the docs',
      })
      const { jobId } = (await delegated.json()) as { jobId: string }

      const res = await app.request(`/routing/background-runs/${jobId}`)
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
  // — is pinned a layer down in `list-background-runs.test.ts`, where a second
  // user's job can be seeded directly (this harness resolves one local user, and
  // widening the package's public API to seed one here isn't worth it).
  it('404s an unknown run', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedWorkspace(db, user.id)
      const app = makeHarness(db)

      const res = await app.request(`/routing/background-runs/${randomUUID()}`)
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
