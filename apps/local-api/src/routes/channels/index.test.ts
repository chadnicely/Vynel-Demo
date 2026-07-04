// Integration tests for the `/workspaces/:workspaceId/channels/...` routes.
// Full HTTP stack: route -> validator -> workspaceScoped -> core op -> repo
// -> SQLite (real, via withTestDatabase).
//
// connectChannel is mocked at the `@vynel/channels` barrel (importActual +
// override just connectChannel) — its telegraf network verification lives in
// the leaf and is unit-tested there. Every other route runs the REAL core op
// against a repo-seeded channel. The `@vynel/channels/test-support` seed
// helpers own the fixtures; a fresh test DB has exactly one user, so
// getOrCreateLocalUser (the Phase-1 resolver) returns that seeded user and
// the seeded workspace resolves for the route.
//
// The credential-leak test seeds a NON-null lastPolledCursor so the
// serializer's omission is actually exercised — botCredentials AND
// lastPolledCursor must NEVER appear in a response (coding.md §1.1).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'

const { connectChannelMock } = vi.hoisted(() => ({ connectChannelMock: vi.fn() }))
vi.mock('@vynel/channels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vynel/channels')>()
  return { ...actual, connectChannel: connectChannelMock }
})

import {
  makeUser,
  makeWorkspace,
  seedChannel,
  seedChannelWithAllowedSender,
  insertPendingChatTurnMessage,
} from '@vynel/channels/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

// A workspace with no channels, owned by the (only) seeded user.
function seedWorkspace(db: Database) {
  const user = insertUser(db, makeUser())
  const workspace = insertWorkspace(db, makeWorkspace(user.id))
  return { user, workspace }
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('channels routes', () => {
  it('GET / returns an empty list initially', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorkspace(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/channels`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  it('GET / lists channels and NEVER returns credentials or the internal cursor', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedChannel(db, { lastPolledCursor: 'internal-cursor' })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/channels`)
      const list = (await res.json()) as Record<string, unknown>[]
      expect(list).toHaveLength(1)
      expect(list[0]?.displayName).toBe('Bakery Bot')
      expect((list[0]?.botMetadata as Record<string, unknown>).username).toBe('bakery_bot')
      expect(list[0]?.botCredentials).toBeUndefined()
      expect(list[0]?.lastPolledCursor).toBeUndefined()
    })
  })

  it('POST /connect returns 201 with a credential-stripped channel', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorkspace(db)
      const now = new Date()
      connectChannelMock.mockResolvedValue({
        id: 'chan-1',
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bakery Bot',
        botCredentials: JSON.stringify({ botToken: 'secret' }),
        botMetadata: JSON.stringify({ username: 'bakery_bot' }),
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: 'internal-cursor',
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/channels/connect`,
        jsonPost({ channelKind: 'telegram', displayName: 'Bakery Bot', botCredentials: { botToken: 'x' } }),
      )
      expect(res.status).toBe(201)
      expect(connectChannelMock).toHaveBeenCalledTimes(1)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.botCredentials).toBeUndefined()
      expect(body.lastPolledCursor).toBeUndefined()
      expect((body.botMetadata as Record<string, unknown>).username).toBe('bakery_bot')
    })
  })

  it('enable / disable toggle the channel', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      const app = createApp({ db, logger: silentLogger })

      const disabled = await app.request(`/workspaces/${workspace.id}/channels/${channel.id}/disable`, {
        method: 'POST',
      })
      expect(disabled.status).toBe(200)
      expect(((await disabled.json()) as { isEnabled: boolean }).isEnabled).toBe(false)

      const enabled = await app.request(`/workspaces/${workspace.id}/channels/${channel.id}/enable`, {
        method: 'POST',
      })
      expect(((await enabled.json()) as { isEnabled: boolean }).isEnabled).toBe(true)
    })
  })

  it('allowed-senders: list / add / delete', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannelWithAllowedSender(db, '777')
      const app = createApp({ db, logger: silentLogger })
      const base = `/workspaces/${workspace.id}/channels/${channel.id}/allowed-senders`

      let list = (await (await app.request(base)).json()) as { id: string }[]
      expect(list).toHaveLength(1)

      const addRes = await app.request(base, jsonPost({ externalSenderId: '888', externalSenderHandle: '@bob' }))
      expect(addRes.status).toBe(201)
      const added = (await addRes.json()) as { id: string }

      list = (await (await app.request(base)).json()) as { id: string }[]
      expect(list).toHaveLength(2)

      const delRes = await app.request(`${base}/${added.id}`, { method: 'DELETE' })
      expect(delRes.status).toBe(204)
      list = (await (await app.request(base)).json()) as { id: string }[]
      expect(list).toHaveLength(1)
    })
  })

  it('GET /:channelId/history returns inbound rows', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      insertPendingChatTurnMessage(db, channel.id, 'hello from telegram')
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/channels/${channel.id}/history`)
      expect(res.status).toBe(200)
      const history = (await res.json()) as { messageBody: string }[]
      expect(history).toHaveLength(1)
      expect(history[0]?.messageBody).toBe('hello from telegram')
    })
  })

  it('DELETE /:channelId disconnects the channel', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      const app = createApp({ db, logger: silentLogger })
      const delRes = await app.request(`/workspaces/${workspace.id}/channels/${channel.id}`, { method: 'DELETE' })
      expect(delRes.status).toBe(204)
      const list = (await (await app.request(`/workspaces/${workspace.id}/channels`)).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it('returns 404 when acting on a channel from another workspace (tenant scoping)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace, channel } = seedChannel(db)
      const otherWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${otherWorkspace.id}/channels/${channel.id}`, { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })
})
