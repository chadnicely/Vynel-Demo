// Integration tests for the `/notebook/...` routes: the merged playbook
// shelf (verified + own), the user-document CRUD, and the immutability
// guarantees — a verified book has no DB row, so PATCH/DELETE on its id
// must 404 (verified books are immutable EVERYWHERE).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listVerifiedNotebooks } from '@vynel/instructions'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

type PlaybookListing = { id: string; title: string; oneLiner: string; verified: boolean }

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function createDocument(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/notebook/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('notebook routes', () => {
  describe('GET /notebook/playbooks', () => {
    it('returns the merged shelf — every verified book first, then the user\'s own', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, {
          scope: 'global',
          title: 'My invoicing playbook',
          body: '# Invoicing\nAlways invoice on the 1st.',
        })
        expect(created.status).toBe(201)

        const res = await app.request('/notebook/playbooks')
        expect(res.status).toBe(200)
        const { playbooks } = (await res.json()) as { playbooks: PlaybookListing[] }

        const verifiedCount = listVerifiedNotebooks().length
        expect(verifiedCount).toBeGreaterThan(0)
        expect(playbooks.slice(0, verifiedCount).every((p) => p.verified)).toBe(true)

        const own = playbooks.filter((p) => !p.verified)
        expect(own).toHaveLength(1)
        expect(own[0]).toMatchObject({
          title: 'My invoicing playbook',
          // The oneLiner derives from the body's first non-empty line,
          // markdown prefixes stripped.
          oneLiner: 'Invoicing',
          verified: false,
        })
      })
    })

    it('shows a workspace book only from that workspace\'s view', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, {
          scope: 'workspace',
          workspaceId: workspace.id,
          title: 'Acme deploy recipe',
          body: 'Deploy steps.',
        })
        expect(created.status).toBe(201)

        const globalView = await app.request('/notebook/playbooks')
        const globalShelf = (await globalView.json()) as { playbooks: PlaybookListing[] }
        expect(globalShelf.playbooks.some((p) => p.title === 'Acme deploy recipe')).toBe(false)

        const workspaceView = await app.request(`/notebook/playbooks?workspaceId=${workspace.id}`)
        const workspaceShelf = (await workspaceView.json()) as { playbooks: PlaybookListing[] }
        expect(workspaceShelf.playbooks.some((p) => p.title === 'Acme deploy recipe')).toBe(true)
      })
    })
  })

  describe('GET /notebook/playbooks/:playbookId', () => {
    it('returns a verified book with its full body', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const verified = listVerifiedNotebooks()[0]!

        const res = await app.request(`/notebook/playbooks/${verified.id}`)
        expect(res.status).toBe(200)
        const playbook = (await res.json()) as PlaybookListing & { body: string }
        expect(playbook).toMatchObject({ id: verified.id, verified: true })
        expect(playbook.body.length).toBeGreaterThan(0)
      })
    })

    it('returns an own book with its body, and 404 for an unknown id', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, {
          scope: 'global',
          title: 'Mine',
          body: 'My body.',
        })
        const { id } = (await created.json()) as { id: string }

        const res = await app.request(`/notebook/playbooks/${id}`)
        expect(res.status).toBe(200)
        expect(((await res.json()) as { body: string }).body).toBe('My body.')

        const missing = await app.request(`/notebook/playbooks/${randomUUID()}`)
        expect(missing.status).toBe(404)
      })
    })
  })

  describe('POST /notebook/documents', () => {
    it('creates a global book (201, notebook mode, enabled)', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await createDocument(app, {
          scope: 'global',
          title: 'Tone of voice',
          body: 'Plain language, always.',
        })
        expect(res.status).toBe(201)
        const document = (await res.json()) as Record<string, unknown>
        expect(document).toMatchObject({
          scope: 'global',
          workspaceId: null,
          mode: 'notebook',
          title: 'Tone of voice',
          enabled: true,
        })
      })
    })

    it('requires a workspaceId for workspace scope (400)', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await createDocument(app, {
          scope: 'workspace',
          title: 'x',
          body: 'y',
        })
        expect(res.status).toBe(400)
      })
    })

    it('rejects a workspace-scoped book for a workspace that does not exist (404)', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await createDocument(app, {
          scope: 'workspace',
          workspaceId: randomUUID(),
          title: 'x',
          body: 'y',
        })
        expect(res.status).toBe(404)
      })
    })

    it('rejects an empty title (400)', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await createDocument(app, { scope: 'global', title: '', body: 'y' })
        expect(res.status).toBe(400)
      })
    })
  })

  describe('PATCH /notebook/documents/:documentId', () => {
    it('updates an own book\'s title/body/enabled', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, {
          scope: 'global',
          title: 'Draft',
          body: 'v1',
        })
        const { id } = (await created.json()) as { id: string }

        const res = await app.request(`/notebook/documents/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Final', body: 'v2', enabled: false }),
        })
        expect(res.status).toBe(200)
        expect((await res.json()) as Record<string, unknown>).toMatchObject({
          title: 'Final',
          body: 'v2',
          enabled: false,
        })
      })
    })

    it('404s on a VERIFIED book id — verified books are immutable everywhere', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const verified = listVerifiedNotebooks()[0]!

        const res = await app.request(`/notebook/documents/${verified.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Vandalized' }),
        })
        expect(res.status).toBe(404)

        // The book itself is untouched — it never had a row to touch.
        const read = await app.request(`/notebook/playbooks/${verified.id}`)
        expect(((await read.json()) as { title: string }).title).toBe(verified.title)
      })
    })

    it('rejects an empty patch (400)', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, { scope: 'global', title: 'x', body: 'y' })
        const { id } = (await created.json()) as { id: string }

        const res = await app.request(`/notebook/documents/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
      })
    })
  })

  describe('DELETE /notebook/documents/:documentId', () => {
    it('deletes an own book (204) and it leaves the document list', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const created = await createDocument(app, { scope: 'global', title: 'x', body: 'y' })
        const { id } = (await created.json()) as { id: string }

        const res = await app.request(`/notebook/documents/${id}`, { method: 'DELETE' })
        expect(res.status).toBe(204)

        const list = await app.request('/notebook/documents')
        const { documents } = (await list.json()) as { documents: { id: string }[] }
        expect(documents).toHaveLength(0)
      })
    })

    it('404s on a VERIFIED book id — no row, no delete', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const verified = listVerifiedNotebooks()[0]!

        const res = await app.request(`/notebook/documents/${verified.id}`, { method: 'DELETE' })
        expect(res.status).toBe(404)
      })
    })
  })

  describe('GET /notebook/documents', () => {
    it('lists the user\'s books across scopes, disabled included (the management view)', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        await createDocument(app, { scope: 'global', title: 'Global book', body: 'g' })
        const created = await createDocument(app, {
          scope: 'workspace',
          workspaceId: workspace.id,
          title: 'Workspace book',
          body: 'w',
        })
        const { id } = (await created.json()) as { id: string }
        await app.request(`/notebook/documents/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        })

        const res = await app.request('/notebook/documents')
        expect(res.status).toBe(200)
        const { documents } = (await res.json()) as {
          documents: { title: string; enabled: boolean }[]
        }
        expect(documents.map((d) => d.title).sort()).toEqual(['Global book', 'Workspace book'])
        expect(documents.find((d) => d.title === 'Workspace book')?.enabled).toBe(false)
      })
    })
  })
})
