// Route tests for /processes — real SQLite, a REAL runner (tiny node commands),
// real monitor rows. The load-bearing pins: ambient ownership (caller header /
// scope → who gets woken), the auto-armed completion watch actually MATCHING
// the settle event (the wake is the feature), and strict scope visibility on
// the list.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  BackgroundProcessRunner,
  settleBackgroundProcess,
  PROCESS_FAILED,
  type BackgroundProcess,
} from '@vynel/processes'
import {
  insertBackgroundProcess,
  findBackgroundProcessById,
} from '@vynel/processes/test-support'
import { findMonitorById, matchesMonitor } from '@vynel/monitors'
import type { AppEnv } from '../../factory.js'
import { withVynelUserDataDir } from '../../sessions/global-root-workspace.js'
import {
  REPORT_CALLER_HEADER,
  serializeReportCaller,
} from '../../sessions/report-caller-header.js'
import { createSpawnedSession } from '@vynel/session/spawned'
import type { AiAgentProvider, NormalizedSessionEvent } from '@vynel/providers'
import { processesApp } from './index.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

// The spawn-time priming turn, faked (the routing tests' helper).
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

function makeHarness(db: Database, runner: BackgroundProcessRunner) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('processRunner', runner)
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/processes', processesApp)
  return app
}

/** The production runner→settle binding, in test shape. */
function makeSettlingRunner(db: Database): BackgroundProcessRunner {
  return new BackgroundProcessRunner({
    onExit: (processId, outcome) =>
      void settleBackgroundProcess(db, {
        processId,
        exitCode: outcome.exitCode,
        ...(outcome.failureReason !== undefined ? { failureReason: outcome.failureReason } : {}),
        outputTail: outcome.outputTail,
      }),
  })
}

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
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

function postJson(app: Hono<AppEnv>, url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function waitForSettle(db: Database, processId: string): Promise<BackgroundProcess> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = findBackgroundProcessById(db, processId)
    if (row !== null && row.status !== 'running') return row
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`process ${processId} never settled`)
}

describe('POST /processes (run_background_process)', () => {
  it('a GLOBAL run: global ground, global-root owner, and a completion watch that MATCHES the settle event', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-proc-'))
      // The ground must EXIST for the spawn — boot creates it in production.
      await mkdir(path.join(dataDir, 'global-root'), { recursive: true })
      await withVynelUserDataDir(dataDir, async () => {
        seedUser(db)
        const runner = makeSettlingRunner(db)
        const app = makeHarness(db, runner)

        const res = await postJson(app, '/processes', {
          command: 'node -e "console.error(\'1 test failed\'); process.exit(1)"',
        })
        expect(res.status).toBe(201)
        const body = (await res.json()) as {
          processId: string
          status: string
          workspaceId: string | null
          monitorId: string | null
        }
        expect(body.status).toBe('running')
        expect(body.workspaceId).toBeNull()
        expect(body.monitorId).not.toBeNull()

        const row = findBackgroundProcessById(db, body.processId)!
        expect(row.ownerKind).toBe('global-root')
        expect(row.cwdPath).toBe(path.join(dataDir, 'global-root'))

        // The wake is the feature: the auto-armed monitor must MATCH the real
        // settle event — filter, types, tenant, all of it.
        const settled = await waitForSettle(db, body.processId)
        expect(settled.status).toBe('failed')
        expect(settled.exitCode).toBe(1)
        expect(settled.outputTail).toContain('1 test failed')

        const monitor = findMonitorById(db, body.monitorId!)!
        expect(monitor.status).toBe('armed')
        expect(monitor.ownerKind).toBe('global-root')
        expect(monitor.payloadFilter).toEqual({ processId: body.processId })
        const [event] = listOutboxEventsByType(db, PROCESS_FAILED)
        expect(event).toBeDefined()
        expect(
          matchesMonitor(monitor, {
            id: event!.id,
            type: event!.type,
            payload: event!.payload as Record<string, unknown>,
            createdAt: event!.createdAt,
          }),
        ).toBe(true)
      })
    })
  })

  it('a WORKSPACE run executes at the workspace folder and wakes the workspace conversation', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const runner = makeSettlingRunner(db)
      const app = makeHarness(db, runner)

      const res = await postJson(app, '/processes', {
        command: 'node -e "process.exit(0)"',
        workspaceId: workspace.id,
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { processId: string; monitorId: string | null }
      const row = findBackgroundProcessById(db, body.processId)!
      // The workspace folder does not exist on disk — the spawn settles as
      // spawn-failed, which is itself the honest wake; the ROW is what this
      // test pins.
      expect(row.ownerKind).toBe('workspace-primary')
      expect(row.workspaceId).toBe(workspace.id)
      expect(row.cwdPath).toBe(workspace.path)
      const monitor = findMonitorById(db, body.monitorId!)!
      expect(monitor.workspaceId).toBe(workspace.id)
      expect(monitor.ownerKind).toBe('workspace-primary')
      await waitForSettle(db, body.processId)
    })
  })

  it('a SPAWNED caller owns its process and its wake, resolved from the header — never input', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-proc-sp-'))
      await mkdir(path.join(dataDir, 'global-root'), { recursive: true })
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await createSpawnedSession(db, primer('sdk-proc-spawned'), {
          userId: user.id,
          name: 'Runner',
          purpose: 'p',
          workspacePath: path.join(dataDir, 'global-root'),
        })
        const runner = makeSettlingRunner(db)
        const app = makeHarness(db, runner)

        const res = await postJson(
          app,
          '/processes',
          { command: 'node -e "process.exit(0)"' },
          {
            [REPORT_CALLER_HEADER]: serializeReportCaller({
              kind: 'spawned-session',
              targetPrimarySessionId: spawned.primarySessionId,
            }),
          },
        )
        expect(res.status).toBe(201)
        const body = (await res.json()) as { processId: string; monitorId: string | null }
        const row = findBackgroundProcessById(db, body.processId)!
        expect(row.ownerKind).toBe('spawned-session')
        expect(row.ownerSessionId).toBe(spawned.primarySessionId)
        const monitor = findMonitorById(db, body.monitorId!)!
        expect(monitor.ownerKind).toBe('spawned-session')
        expect(monitor.ownerSessionId).toBe(spawned.primarySessionId)
        await waitForSettle(db, body.processId)
      })
    })
  })
})

describe('GET /processes + /:processId + kill', () => {
  function seedRunningRow(db: Database, userId: string, workspaceId: string | null): string {
    const id = randomUUID()
    const now = new Date()
    insertBackgroundProcess(db, {
      id,
      userId,
      workspaceId,
      ownerKind: workspaceId === null ? 'global-root' : 'workspace-primary',
      ownerSessionId: null,
      command: 'pnpm test',
      cwdPath: '/tmp/x',
      status: 'running',
      pid: null,
      exitCode: null,
      failureReason: null,
      outputTail: null,
      timeoutMs: 60_000,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    return id
  }

  it('the list is strictly scoped: global shows global rows, a workspace its own; foreign 404s', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const stranger = seedUser(db)
      const foreign = seedWorkspace(db, stranger.id, 'Theirs')
      const globalId = seedRunningRow(db, user.id, null)
      const workspaceId = seedRunningRow(db, user.id, workspace.id)
      const runner = new BackgroundProcessRunner()
      const app = makeHarness(db, runner)

      const globalList = (await (await app.request('/processes')).json()) as { processId: string }[]
      expect(globalList.map((p) => p.processId)).toEqual([globalId])

      const wsList = (await (
        await app.request(`/processes?workspaceId=${workspace.id}`)
      ).json()) as { processId: string }[]
      expect(wsList.map((p) => p.processId)).toEqual([workspaceId])

      expect((await app.request(`/processes?workspaceId=${foreign.id}`)).status).toBe(404)
    })
  })

  it('get answers the row; kill settles an orphan and refuses a finished process; unknown 404s', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const id = seedRunningRow(db, user.id, null)
      const runner = new BackgroundProcessRunner()
      const app = makeHarness(db, runner)

      const got = (await (await app.request(`/processes/${id}`)).json()) as { status: string }
      expect(got.status).toBe('running')

      const killed = await app.request(`/processes/${id}/kill`, { method: 'POST' })
      expect(killed.status).toBe(200)
      expect(((await killed.json()) as { failureReason: string }).failureReason).toBe('killed')

      const again = await app.request(`/processes/${id}/kill`, { method: 'POST' })
      expect(again.status).toBe(400)

      expect((await app.request(`/processes/${randomUUID()}`)).status).toBe(404)
      expect((await app.request(`/processes/${randomUUID()}/kill`, { method: 'POST' })).status).toBe(
        404,
      )
    })
  })
})
