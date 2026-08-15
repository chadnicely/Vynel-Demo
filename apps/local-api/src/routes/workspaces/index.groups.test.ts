// Integration tests for the `/workspaces/groups` routes + the membership
// move (PUT /workspaces/:workspaceId/group). Split from index.test.ts per
// structure-standard.md "File size cap" (the mutations-file precedent).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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

function seedWorkspace(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'project',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

async function createGroupViaApi(
  app: ReturnType<typeof createApp>,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await app.request('/workspaces/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; name: string }
}

describe('workspaces routes — groups', () => {
  it('create + list round-trips a folder (name trimmed by the core)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })

      const created = await createGroupViaApi(app, '  Development  ')
      expect(created.name).toBe('Development')

      const listRes = await app.request('/workspaces/groups')
      expect(listRes.status).toBe(200)
      const listed = (await listRes.json()) as { id: string; name: string }[]
      expect(listed.map((group) => group.id)).toContain(created.id)
    })
  })

  it('rename returns the updated folder; unknown id 404s', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const group = await createGroupViaApi(app, 'Development')

      const renameRes = await app.request(`/workspaces/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Clients' }),
      })
      expect(renameRes.status).toBe(200)
      expect(((await renameRes.json()) as { name: string }).name).toBe('Clients')

      const missingRes = await app.request(`/workspaces/groups/${randomUUID()}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Nope' }),
      })
      expect(missingRes.status).toBe(404)
    })
  })

  it('PUT /:workspaceId/group moves into a folder, back to root, and 404s unknown folders', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })
      const group = await createGroupViaApi(app, 'Development')

      const assignRes = await app.request(`/workspaces/${workspace.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id }),
      })
      expect(assignRes.status).toBe(200)
      expect(((await assignRes.json()) as { groupId: string | null }).groupId).toBe(group.id)

      const clearRes = await app.request(`/workspaces/${workspace.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: null }),
      })
      expect(clearRes.status).toBe(200)
      expect(((await clearRes.json()) as { groupId: string | null }).groupId).toBeNull()

      const unknownRes = await app.request(`/workspaces/${workspace.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: randomUUID() }),
      })
      expect(unknownRes.status).toBe(404)
    })
  })

  it('DELETE detaches members and 404s a second delete', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })
      const group = await createGroupViaApi(app, 'Development')

      const assignRes = await app.request(`/workspaces/${workspace.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id }),
      })
      expect(assignRes.status).toBe(200)

      const deleteRes = await app.request(`/workspaces/groups/${group.id}`, {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(204)
      expect(findWorkspaceById(db, workspace.id)?.groupId).toBeNull()

      const secondDeleteRes = await app.request(`/workspaces/groups/${group.id}`, {
        method: 'DELETE',
      })
      expect(secondDeleteRes.status).toBe(404)
    })
  })
})
