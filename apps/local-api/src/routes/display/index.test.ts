// Integration tests for `/display` — the five board routes through the full
// HTTP stack (route -> validator -> userScoped -> real core op -> repo ->
// SQLite via withTestDatabase). No mocks; the only injected thing is the live
// sink, because a route test has no WebSocket.
//
// TENANT-ISOLATION ordering invariant (the schedules user-scoped precedent):
// the Phase-1 resolver returns the FIRST user row, so the local user is
// inserted BEFORE the stranger — otherwise the roles silently invert and the
// not-owned test would pass for the wrong reason.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { DisplayLiveFrame } from '@vynel/contracts/display/display-live'
import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

type RecordingSink = {
  publish(userId: string, frame: DisplayLiveFrame): void
  calls: { userId: string; frame: DisplayLiveFrame }[]
}

function createRecordingSink(): RecordingSink {
  const calls: RecordingSink['calls'] = []
  return { calls, publish: (userId, frame) => void calls.push({ userId, frame }) }
}

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function seedUser(db: Database, displayName: string): string {
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
  }).id
}

function seedWorkspace(db: Database, userId: string, name: string): string {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }).id
}

const markdown = (body = '# This week') => ({ kind: 'markdown' as const, body })

async function addWidget(
  app: ReturnType<typeof createApp>,
  payload: Record<string, unknown>,
): Promise<Response> {
  return await app.request('/display/widgets', jsonBody('POST', payload))
}

describe('display routes', () => {
  it('adds, lists, updates, removes and clears a scope’s board', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })

      const empty = await app.request('/display/widgets?scope=global')
      expect(empty.status).toBe(200)
      expect(await empty.json()).toEqual([])

      const created = await addWidget(app, {
        scope: 'global',
        title: 'This week',
        content: markdown(),
        slot: 'stage',
        size: 'lg',
      })
      expect(created.status).toBe(201)
      const widget = (await created.json()) as DisplayWidgetView
      expect(widget).toMatchObject({
        scopeKey: 'global',
        title: 'This week',
        kind: 'markdown',
        slot: 'stage',
        size: 'lg',
        expiresAt: null,
      })

      const listed = await app.request('/display/widgets?scope=global')
      expect((await listed.json()) as DisplayWidgetView[]).toHaveLength(1)

      const updated = await app.request(
        `/display/widgets/${widget.id}`,
        jsonBody('PATCH', {
          title: 'This week so far',
          content: { kind: 'metric', value: '12', label: 'runs', tone: 'live' },
        }),
      )
      expect(updated.status).toBe(200)
      // Patching content rewrites `kind` — the row's kind IS content.kind.
      expect(await updated.json()).toMatchObject({
        id: widget.id,
        title: 'This week so far',
        kind: 'metric',
      })

      const removed = await app.request(`/display/widgets/${widget.id}/remove`, { method: 'POST' })
      expect(removed.status).toBe(200)
      expect((await removed.json()) as DisplayWidgetView).toMatchObject({ id: widget.id })
      expect((await (await app.request('/display/widgets?scope=global')).json())).toEqual([])

      await addWidget(app, { scope: 'global', title: 'One', content: markdown('one') })
      await addWidget(app, { scope: 'global', title: 'Two', content: markdown('two') })
      const cleared = await app.request('/display/clear', jsonBody('POST', { scope: 'global' }))
      expect(cleared.status).toBe(200)
      expect(await cleared.json()).toEqual({ clearedCount: 2 })
      expect((await (await app.request('/display/widgets?scope=global')).json())).toEqual([])
    })
  })

  it('keeps a workspace board separate from the global one', async () => {
    await withTestDatabase(async (db) => {
      // The local user is the FIRST row, so seeding them here is what the
      // resolver will hand the routes; the workspace hangs off that same id.
      const localUserId = seedUser(db, 'Local')
      const workspaceId = seedWorkspace(db, localUserId, 'Acme')
      const app = createApp({ db, logger: silentLogger })

      const created = await addWidget(app, {
        scope: workspaceId,
        title: 'Acme runs',
        content: markdown('acme'),
      })
      expect(created.status).toBe(201)
      expect(((await created.json()) as DisplayWidgetView).scopeKey).toBe(workspaceId)

      const workspaceBoard = (await (
        await app.request(`/display/widgets?scope=${workspaceId}`)
      ).json()) as DisplayWidgetView[]
      expect(workspaceBoard).toHaveLength(1)
      expect((await (await app.request('/display/widgets?scope=global')).json())).toEqual([])
    })
  })

  it("answers a stranger's workspace scope with the same 404 as a nonexistent one", async () => {
    await withTestDatabase(async (db) => {
      // The local user must exist FIRST (the resolver takes the first row).
      const localUserId = seedUser(db, 'Local')
      const strangerId = seedUser(db, 'Stranger')
      const strangersWorkspace = seedWorkspace(db, strangerId, "Stranger's")
      const app = createApp({ db, logger: silentLogger })
      // `findSingleLocalUser` is a bare `limit(1)` — insertion order is
      // SQLite's incidental rowid behavior, not a promise. Assert the roles
      // did not invert, or every expectation below would pass for the wrong
      // reason (the stranger asking about their OWN workspace).
      expect(getOrCreateLocalUser(db, { logger: silentLogger }).id).toBe(localUserId)

      for (const scope of [strangersWorkspace, randomUUID()]) {
        const listed = await app.request(`/display/widgets?scope=${scope}`)
        expect(listed.status).toBe(404)
        expect(((await listed.json()) as { code: string }).code).toBe('not_found')

        const added = await addWidget(app, { scope, title: 'Nope', content: markdown() })
        expect(added.status).toBe(404)

        const cleared = await app.request('/display/clear', jsonBody('POST', { scope }))
        expect(cleared.status).toBe(404)
      }
      // …and nothing of the stranger's leaked onto the caller's board.
      expect((await (await app.request('/display/widgets?scope=global')).json())).toEqual([])
    })
  })

  it('rejects content that is not a legal widget, and a title over the cap', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })

      const ragged = await addWidget(app, {
        scope: 'global',
        title: 'Runs',
        // Row 2 has one cell for two columns — a ragged table draws broken.
        content: { kind: 'table', columns: ['Day', 'Runs'], rows: [['Mon', '3'], ['Tue']] },
      })
      expect(ragged.status).toBe(400)
      // The boundary answers with the failing zod issue, path included — that
      // whole body is what a tool call gets back, so it has to NAME the fault.
      expect(await ragged.text()).toContain('row 2 has 1 cells but the table has 2 columns')

      const unknownKind = await addWidget(app, {
        scope: 'global',
        title: 'Runs',
        content: { kind: 'html', body: '<script>alert(1)</script>' },
      })
      expect(unknownKind.status).toBe(400)

      const longTitle = await addWidget(app, {
        scope: 'global',
        title: 'x'.repeat(81),
        content: markdown(),
      })
      expect(longTitle.status).toBe(400)

      const badPatch = await app.request(
        `/display/widgets/${randomUUID()}`,
        jsonBody('PATCH', { content: { kind: 'chart', type: 'pie', series: [] } }),
      )
      expect(badPatch.status).toBe(400)
    })
  })

  // A self-cleaning card: the tool says WHEN it should go, and the sweep (on
  // every read, and once at boot) is what makes that happen.
  it('takes an expiry on both writes, and only one that is still ahead', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
      const yesterday = new Date(Date.now() - 86_400_000).toISOString()

      const added = await addWidget(app, {
        scope: 'global',
        title: 'Today',
        content: markdown(),
        expiresAt: tomorrow,
      })
      expect(added.status).toBe(201)
      const widget = (await added.json()) as DisplayWidgetView
      expect(widget.expiresAt).toBe(tomorrow)

      const later = new Date(Date.now() + 172_800_000).toISOString()
      const patched = await app.request(
        `/display/widgets/${widget.id}`,
        jsonBody('PATCH', { expiresAt: later }),
      )
      expect(patched.status).toBe(200)
      expect(((await patched.json()) as DisplayWidgetView).expiresAt).toBe(later)

      // An expiry already past would delete the card on the next read — the
      // write would look like it silently did nothing.
      const backdated = await addWidget(app, {
        scope: 'global',
        title: 'Gone already',
        content: markdown(),
        expiresAt: yesterday,
      })
      expect(backdated.status).toBe(400)
      expect(await backdated.text()).toContain('future')

      const backdatedPatch = await app.request(
        `/display/widgets/${widget.id}`,
        jsonBody('PATCH', { expiresAt: yesterday }),
      )
      expect(backdatedPatch.status).toBe(400)

      const notATimestamp = await addWidget(app, {
        scope: 'global',
        title: 'Whenever',
        content: markdown(),
        expiresAt: 'tomorrow',
      })
      expect(notATimestamp.status).toBe(400)
    })
  })

  it('holds twelve per scope — the thirteenth evicts the oldest, never an error', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })

      const ids: string[] = []
      for (let index = 0; index < 13; index += 1) {
        const response = await addWidget(app, {
          scope: 'global',
          title: `Card ${index}`,
          content: markdown(`card ${index}`),
        })
        expect(response.status).toBe(201)
        ids.push(((await response.json()) as DisplayWidgetView).id)
      }

      const board = (await (
        await app.request('/display/widgets?scope=global')
      ).json()) as DisplayWidgetView[]
      expect(board).toHaveLength(12)
      const boardIds = board.map((widget) => widget.id)
      expect(boardIds).not.toContain(ids[0])
      expect(boardIds).toContain(ids[12])
    })
  })

  it('hands every state change to the live sink, addressed to the owner', async () => {
    await withTestDatabase(async (db) => {
      const displayLiveSink = createRecordingSink()
      const app = createApp({ db, logger: silentLogger, displayLiveSink })

      const created = await addWidget(app, {
        scope: 'global',
        title: 'Runs',
        content: markdown('runs'),
      })
      const widget = (await created.json()) as DisplayWidgetView
      expect(displayLiveSink.calls).toEqual([
        { userId: expect.any(String), frame: { kind: 'upserted', widget } },
      ])
      const ownerId = displayLiveSink.calls[0]!.userId

      await app.request(`/display/widgets/${widget.id}`, jsonBody('PATCH', { title: 'Runs today' }))
      expect(displayLiveSink.calls[1]!.frame).toMatchObject({ kind: 'upserted' })

      await app.request(`/display/widgets/${widget.id}/remove`, { method: 'POST' })
      expect(displayLiveSink.calls[2]).toEqual({
        userId: ownerId,
        frame: { kind: 'removed', widgetId: widget.id, scopeKey: 'global' },
      })

      await addWidget(app, { scope: 'global', title: 'Again', content: markdown('again') })
      await app.request('/display/clear', jsonBody('POST', { scope: 'global' }))
      expect(displayLiveSink.calls.at(-1)).toEqual({
        userId: ownerId,
        frame: { kind: 'cleared', scopeKey: 'global' },
      })
    })
  })

  it('publishes nothing when no sink is wired (the ops stay silent, not broken)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const created = await addWidget(app, {
        scope: 'global',
        title: 'Quiet',
        content: markdown('quiet'),
      })
      expect(created.status).toBe(201)
    })
  })
})
