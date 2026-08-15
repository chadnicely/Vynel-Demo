// Route test for GET /activity/stream — the SSE liveness feed. Drives the
// REAL app (createApp + a real SQLite test db) with an injected feed: asserts
// the live publish path, the snapshot replay for a mid-turn attach, and that
// the stream frames carry the SessionActivityEvent JSON.

import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { SessionActivityFeed, buildSessionTurnRecorder } from '@vynel/session/runtime'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  enqueueWorkspaceDelegation,
  enqueueReportDelivery,
  findDelegationJobById,
} from '@vynel/orchestration'
import { randomUUID } from 'node:crypto'
import { createApp } from '../../app.js'

function makeWorkspace(userId: string, name: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

const silentLogger = pino({ level: 'silent' })

/** Read the stream until `predicate` matches the accumulated text (or timeout). */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (!predicate(text) && Date.now() < deadline) {
      const race = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ])
      if (race === 'timeout') continue
      if (race.done) break
      text += decoder.decode(race.value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text
}

describe('GET /activity/stream', () => {
  it('streams turn-started / turn-updated / turn-ended published after attach', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      const res = await app.request('/activity/stream')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      // Let the SSE callback attach its subscriber, then play a producer.
      await new Promise((resolve) => setTimeout(resolve, 25))
      const handle = activityFeed.begin({ userId, scopeKind: 'global', origin: 'telegram' })
      handle.sessionResolved('sess-42')
      handle.end()

      const text = await readUntil(res.body!, (t) => t.includes('turn-ended'))
      expect(text).toContain('event: turn-started')
      expect(text).toContain('"origin":"telegram"')
      expect(text).toContain('event: turn-updated')
      expect(text).toContain('"sessionId":"sess-42"')
      expect(text).toContain('event: turn-ended')
    })
  })

  it('replays the in-flight snapshot to a subscriber attaching mid-turn', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      const handle = activityFeed.begin({
        userId,
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'schedule',
      })
      handle.sessionResolved('sess-7')

      const res = await app.request('/activity/stream')
      const text = await readUntil(res.body!, (t) => t.includes('turn-started'))
      handle.end()

      expect(text).toContain('event: turn-started')
      expect(text).toContain('"workspaceId":"ws-1"')
      expect(text).toContain('"sessionId":"sess-7"') // snapshot carries learned identity
      expect(text).toContain('"origin":"schedule"')
    })
  })

  it("does not leak another user's turns", async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      getOrCreateLocalUser(db, { logger: silentLogger })

      activityFeed.begin({ userId: 'someone-else', scopeKind: 'global', origin: 'web' })

      const res = await app.request('/activity/stream')
      const text = await readUntil(res.body!, (t) => t.includes('turn-started'), 500)
      expect(text).not.toContain('turn-started')
    })
  })

  it('turn-started frames carry the persona-sessions enrichment', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      activityFeed.begin({
        userId,
        scopeKind: 'global',
        origin: 'delegation',
        jobId: 'job-1',
        threadId: 'thread-1',
        partialSessionId: 'trace-1',
        primarySessionId: 'primary-1',
        taskLabel: 'Set up the login page',
        personaName: 'Nova',
      })

      const res = await app.request('/activity/stream')
      const text = await readUntil(res.body!, (t) => t.includes('turn-started'))
      expect(text).toContain('"jobId":"job-1"')
      expect(text).toContain('"threadId":"thread-1"')
      expect(text).toContain('"partialSessionId":"trace-1"')
      expect(text).toContain('"primarySessionId":"primary-1"')
      expect(text).toContain('"taskLabel":"Set up the login page"')
      expect(text).toContain('"personaName":"Nova"')
    })
  })
})

describe('GET /activity/running', () => {
  it('returns the durable in-flight turns for the local user only, ISO-stamped', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed({
        turnRecorder: buildSessionTurnRecorder(db, silentLogger),
      })
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      const handle = activityFeed.begin({
        userId,
        scopeKind: 'global',
        origin: 'delegation',
        jobId: 'job-run-1',
        threadId: 'thread-run-1',
        partialSessionId: 'trace-run-1',
      })
      // Another user's running turn must not appear... but a foreign userId
      // violates the FK — the tenant filter is already repo-tested; here the
      // route contract is the subject.
      const res = await app.request('/activity/running')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        turns: Array<{ turnId: string; jobId: string | null; startedAt: string }>
      }
      expect(body.turns).toHaveLength(1)
      expect(body.turns[0]!.turnId).toBe(handle.turnId)
      expect(body.turns[0]!.jobId).toBe('job-run-1')
      // ISO-8601 round-trips.
      expect(new Date(body.turns[0]!.startedAt).toISOString()).toBe(body.turns[0]!.startedAt)

      // Ended turns leave the read.
      handle.end()
      const after = await app.request('/activity/running')
      expect(((await after.json()) as { turns: unknown[] }).turns).toEqual([])
    })
  })
})

describe('GET /activity/messages', () => {
  it('reports the ask and the reply, each pointing the way it travelled', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db)
      const home = insertWorkspace(db, makeWorkspace(user.id, 'Home'))
      const target = insertWorkspace(db, makeWorkspace(user.id, 'Acme'))
      const askId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'session-home',
        workspaceId: target.id,
        workspacePath: target.path,
        workspaceName: target.name,
        taskText: 'ship it',
        requesterWorkspaceId: home.id,
      })
      const ask = findDelegationJobById(db, askId)!
      const thread = ask.threadId ?? ask.partialSessionId
      enqueueReportDelivery(db, {
        ...(thread === null ? {} : { threadId: thread }),
        userId: user.id,
        reporterSessionId: 'session-acme-child',
        reporterLabel: 'Mark · Acme',
        reportBody: 'shipped',
        requester: {
          kind: 'workspace-primary',
          workspaceId: home.id,
          workspacePath: home.path,
        },
      })

      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/activity/messages')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        edges: Array<Record<string, unknown>>
      }
      const ways = Object.fromEntries(
        body.edges.map((edge) => [edge.direction, edge]),
      )
      expect(ways.ask).toMatchObject({
        fromWorkspaceId: home.id,
        toWorkspaceId: target.id,
      })
      expect(ways.reply).toMatchObject({
        fromSessionId: 'session-acme-child',
        fromWorkspaceId: target.id,
        toWorkspaceId: home.id,
      })
    })
  })

  it('sees nothing outside the window it was asked for', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db)
      const target = insertWorkspace(db, makeWorkspace(user.id, 'Acme'))
      enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: 'session-home',
          workspaceId: target.id,
          workspacePath: target.path,
          workspaceName: target.name,
          taskText: 'ship it',
        },
        { now: () => new Date(Date.now() - 600_000) },
      )

      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/activity/messages?withinSeconds=60')
      expect(((await res.json()) as { edges: unknown[] }).edges).toEqual([])
    })
  })

  it('rejects a window outside the allowed range', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      expect((await app.request('/activity/messages?withinSeconds=99999')).status).toBe(400)
    })
  })
})
