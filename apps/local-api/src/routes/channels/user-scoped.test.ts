// Integration tests for the USER-scoped `/channels/...` routes (global +
// cross-workspace). Full HTTP stack: route -> validator -> userScoped -> core op
// -> repo -> SQLite (real, via withTestDatabase).
//
// connectChannel is mocked at the `@vynel/channels` barrel (its telegraf network
// verification is unit-tested in the leaf); every other route runs the REAL
// user-scoped core op against a repo-seeded channel.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1) = first insert). So the "attacker"
// (the resolved local user) is `insertUser`'d BEFORE the victim's user+channel,
// or the roles silently invert and the test would pass for the wrong reason.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
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
  insertChannel,
  type NewChannel,
} from '@vynel/channels/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

// A channel row for a SPECIFIC owner + scope (workspaceId null = global).
function seedChannelRow(
  db: Database,
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChannel> = {},
) {
  const now = new Date()
  return insertChannel(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    channelKind: 'telegram',
    displayName: 'Bakery Bot',
    botCredentials: JSON.stringify({ botToken: 'secret' }),
    botMetadata: JSON.stringify({ username: 'bakery_bot' }),
    connectionStatus: 'healthy',
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

// A canned connectChannel result (the mock returns it; the serializer runs on it).
function fakeConnectedChannel(userId: string, workspaceId: string | null) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    channelKind: 'telegram' as const,
    displayName: 'New Bot',
    botCredentials: JSON.stringify({ botToken: 'secret' }),
    botMetadata: JSON.stringify({ username: 'new_bot' }),
    connectionStatus: 'healthy' as const,
    connectionStatusMessage: null,
    lastPolledCursor: 'internal-cursor',
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('user-scoped channels routes', () => {
  it('GET / lists a user’s GLOBAL + WORKSPACE channels, credentials stripped', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(localUser.id))
      seedChannelRow(db, localUser.id, null, { displayName: 'Global Bot', lastPolledCursor: 'x' })
      seedChannelRow(db, localUser.id, ws.id, { displayName: 'WS Bot' })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/channels')
      expect(res.status).toBe(200)
      const list = (await res.json()) as Record<string, unknown>[]
      expect(list).toHaveLength(2)
      expect(list.some((c) => c.workspaceId === null)).toBe(true)
      expect(list.some((c) => c.workspaceId === ws.id)).toBe(true)
      for (const c of list) {
        expect(c.botCredentials).toBeUndefined()
        expect(c.lastPolledCursor).toBeUndefined()
      }
    })
  })

  it('POST / with scope:global connects with workspaceId=null (201)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      connectChannelMock.mockImplementation((_db, input) =>
        Promise.resolve(fakeConnectedChannel(input.userId, input.workspaceId)),
      )
      const res = await app.request(
        '/channels',
        jsonPost({ scope: 'global', channelKind: 'telegram', displayName: 'X', botCredentials: { botToken: 'x' } }),
      )
      expect(res.status).toBe(201)
      expect(connectChannelMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspaceId: null }),
        expect.anything(),
      )
      const body = (await res.json()) as Record<string, unknown>
      expect(body.workspaceId).toBeNull()
      expect(body.botCredentials).toBeUndefined()
    })
  })

  it('POST / with scope:workspace + workspaceId connects to that workspace (201)', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(localUser.id))
      const app = createApp({ db, logger: silentLogger })
      connectChannelMock.mockImplementation((_db, input) =>
        Promise.resolve(fakeConnectedChannel(input.userId, input.workspaceId)),
      )
      const res = await app.request(
        '/channels',
        jsonPost({ scope: 'workspace', workspaceId: ws.id, channelKind: 'telegram', displayName: 'X', botCredentials: { botToken: 'x' } }),
      )
      expect(res.status).toBe(201)
      expect(connectChannelMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspaceId: ws.id }),
        expect.anything(),
      )
    })
  })

  it('POST / with scope:workspace but NO workspaceId is rejected (400) before core', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/channels',
        jsonPost({ scope: 'workspace', channelKind: 'telegram', displayName: 'X', botCredentials: { botToken: 'x' } }),
      )
      expect(res.status).toBe(400)
      expect(connectChannelMock).not.toHaveBeenCalled()
    })
  })

  it('manages a GLOBAL channel end-to-end: get / rename / disable / enable / allowed-senders / history / delete', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const channel = seedChannelRow(db, localUser.id, null)
      const app = createApp({ db, logger: silentLogger })

      expect((await app.request(`/channels/${channel.id}`)).status).toBe(200)

      // Padded name: the boundary trims. Whitespace-only: 400, nothing persists.
      const renamed = await app.request(`/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: '  Renamed Bot  ' }),
      })
      expect(renamed.status).toBe(200)
      const renamedBody = (await renamed.json()) as { displayName: string; botCredentials?: unknown }
      expect(renamedBody.displayName).toBe('Renamed Bot')
      expect(renamedBody.botCredentials).toBeUndefined()
      expect(
        (
          await app.request(`/channels/${channel.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: '   ' }),
          })
        ).status,
      ).toBe(400)

      const disabled = await app.request(`/channels/${channel.id}/disable`, { method: 'POST' })
      expect(((await disabled.json()) as { isEnabled: boolean }).isEnabled).toBe(false)
      const enabled = await app.request(`/channels/${channel.id}/enable`, { method: 'POST' })
      expect(((await enabled.json()) as { isEnabled: boolean }).isEnabled).toBe(true)

      const base = `/channels/${channel.id}/allowed-senders`
      const addRes = await app.request(base, jsonPost({ externalSenderId: '888', externalSenderHandle: '@bob' }))
      expect(addRes.status).toBe(201)
      const added = (await addRes.json()) as { id: string }
      expect(((await (await app.request(base)).json()) as unknown[])).toHaveLength(1)
      expect((await app.request(`${base}/${added.id}`, { method: 'DELETE' })).status).toBe(204)
      expect(((await (await app.request(base)).json()) as unknown[])).toHaveLength(0)

      expect((await app.request(`/channels/${channel.id}/history`)).status).toBe(200)
      expect((await app.request(`/channels/${channel.id}`, { method: 'DELETE' })).status).toBe(204)
      expect(((await (await app.request('/channels')).json()) as unknown[])).toHaveLength(0)
    })
  })

  it('TENANT ISOLATION: a user cannot see or act on another user’s channel (404)', async () => {
    await withTestDatabase(async (db) => {
      // Attacker = the resolved local user; MUST be inserted first (findSingleLocalUser = first row).
      insertUser(db, makeUser())
      // Victim = a different (second) user + their channel, via seedChannel.
      const { channel: victim } = seedChannel(db)
      const app = createApp({ db, logger: silentLogger })

      // The attacker's list never shows the victim's channel.
      expect(((await (await app.request('/channels')).json()) as unknown[])).toHaveLength(0)

      // Every id-op on the victim's channel is an identical 404.
      expect((await app.request(`/channels/${victim.id}`)).status).toBe(404)
      expect(
        (
          await app.request(`/channels/${victim.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: 'Hijacked' }),
          })
        ).status,
      ).toBe(404)
      expect((await app.request(`/channels/${victim.id}`, { method: 'DELETE' })).status).toBe(404)
      expect((await app.request(`/channels/${victim.id}/enable`, { method: 'POST' })).status).toBe(404)
      expect((await app.request(`/channels/${victim.id}/disable`, { method: 'POST' })).status).toBe(404)
      expect((await app.request(`/channels/${victim.id}/allowed-senders`)).status).toBe(404)
      expect(
        (await app.request(`/channels/${victim.id}/allowed-senders`, jsonPost({ externalSenderId: '9' }))).status,
      ).toBe(404)
      expect((await app.request(`/channels/${victim.id}/history`)).status).toBe(404)
      // Each rejected op threw in the guard BEFORE its repo mutation, so the
      // victim's channel was never touched (the DELETE/enable/disable all 404'd).
    })
  })
})
