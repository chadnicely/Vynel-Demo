// Integration tests for the `/workspaces/:workspaceId/chat/...` routes that
// never touch the AI provider — full HTTP stack (route → workspaceScoped /
// sessionScoped triple-check → core op → repo → SQLite). The provider-reaching
// routes (interrupt, /context) live in `index.provider.test.ts`; the SSE turn
// stream smoke lives in `../../streams/chat-turn.test.ts` — both mock the
// provider registry at the module boundary (approvals precedent), which this
// file deliberately avoids so these routes prove the unmocked path.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  insertChatMessage,
  findChatSessionById,
  type NewChatSession,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import { persistAttachedImages } from '@vynel/chat'
import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import { getOrCreatePrimarySession } from '@vynel/session/continuity'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(db: Database, workspacePath = `/tmp/vynel/${randomUUID()}`) {
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
    kind: 'personal',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function makeSession(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'T',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeMessage(sessionId: string, body: string): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  }
}

describe('GET /chat/sessions', () => {
  it('lists sessions, excluding archived + soft-deleted by default', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const listed = insertChatSession(db, makeSession(user.id, workspace.id))
      insertChatSession(db, makeSession(user.id, workspace.id, { isArchived: true }))
      insertChatSession(db, makeSession(user.id, workspace.id, { deletedAt: new Date() }))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ id: string }>
      expect(body.map((s) => s.id)).toEqual([listed.id])
    })
  })

  it('includes archived sessions when includeArchived=true', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      insertChatSession(db, makeSession(user.id, workspace.id))
      insertChatSession(db, makeSession(user.id, workspace.id, { isArchived: true }))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions?includeArchived=true`,
      )
      expect(res.status).toBe(200)
      expect((await res.json()) as unknown[]).toHaveLength(2)
    })
  })

  it('404s for an unknown workspace', async () => {
    await withTestDatabase(async (db) => {
      seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${randomUUID()}/chat/sessions`)
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /chat/sessions/search', () => {
  it('finds messages via full-text search', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      insertChatMessage(db, makeMessage(session.id, 'apple cinnamon recipe'))
      insertChatMessage(db, makeMessage(session.id, 'unrelated banana bread'))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions/search?query=cinnamon`,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ sessionId: string; snippet: string }>
      expect(body).toHaveLength(1)
      expect(body[0]!.sessionId).toBe(session.id)
    })
  })

  it('400s when the query is shorter than 2 characters', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/search?query=a`)
      expect(res.status).toBe(400)
    })
  })
})

describe('GET /chat/continuing', () => {
  it('returns nulls when no continuing conversation exists yet', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/chat/continuing`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ rootSessionId: null, currentSdkSessionId: null })
    })
  })

  it('resolves the primary once the first continue-mode turn created it', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const primary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/continuing`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        rootSessionId: primary.id,
        currentSdkSessionId: null,
      })
    })
  })
})

describe('GET /chat/sessions/:sessionId', () => {
  it('returns the full detail (session + messages + tool calls)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      insertChatMessage(db, makeMessage(session.id, 'hello there'))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${session.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        session: { id: string }
        messages: Array<{ body: string }>
        toolCallsByMessageId: Record<string, unknown[]>
      }
      expect(body.session.id).toBe(session.id)
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0]!.body).toBe('hello there')
      expect(body.toolCallsByMessageId).toEqual({})
    })
  })

  it('enriches delegation-traced rows with the task label (parity with root.getSession)', async () => {
    // Slice ④ turned the workspace thread's Watch chips ON — its detail read
    // must carry the same serve-time label the global read does, or the two
    // surfaces would name the same chip differently.
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-parent',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'Set up the login page',
      })
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!
      insertChatMessage(db, {
        ...makeMessage(session.id, 'On it.'),
        role: 'assistant',
        partialSessionId,
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${session.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        messages: Array<{ body: string; delegationTaskLabel?: string }>
      }
      expect(body.messages[0]!.delegationTaskLabel).toBe('Set up the login page')
    })
  })

  it("404s for a session in another of the user's workspaces (triple-check)", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const now = new Date()
      const otherWorkspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Other',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const foreign = insertChatSession(db, makeSession(user.id, otherWorkspace.id))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${foreign.id}`)
      expect(res.status).toBe(404)
    })
  })

  it('404s for a soft-deleted session', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(
        db,
        makeSession(user.id, workspace.id, { deletedAt: new Date() }),
      )
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${session.id}`)
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /chat/sessions/:sessionId/images/:filename', () => {
  it('serves persisted image bytes with the right content type + nosniff', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-chat-images-'))
    try {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db, workspaceDir)
        const session = insertChatSession(db, makeSession(user.id, workspace.id))
        const pngBytes = Buffer.from('not-really-a-png-but-bytes')
        await persistAttachedImages({
          workspacePath: workspaceDir,
          sessionId: session.id,
          images: [
            { filename: 'shot.png', mimeType: 'image/png', base64Data: pngBytes.toString('base64') },
          ],
        })
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(
          `/workspaces/${workspace.id}/chat/sessions/${session.id}/images/shot.png`,
        )
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('image/png')
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(Buffer.from(await res.arrayBuffer())).toEqual(pngBytes)
      })
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  it('404s for a missing image', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-chat-images-'))
    try {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db, workspaceDir)
        const session = insertChatSession(db, makeSession(user.id, workspace.id))
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(
          `/workspaces/${workspace.id}/chat/sessions/${session.id}/images/missing.png`,
        )
        expect(res.status).toBe(404)
      })
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})

describe('PATCH /chat/sessions/:sessionId', () => {
  it('renames the session', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Quarterly planning' }),
      })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { title: string }).title).toBe('Quarterly planning')
      expect(findChatSessionById(db, session.id)?.title).toBe('Quarterly planning')
    })
  })

  it('400s on an empty title', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      })
      expect(res.status).toBe(400)
    })
  })

  it('404s for an unknown session id', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/chat/sessions/${randomUUID()}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('POST /chat/sessions/:sessionId/archive + /unarchive', () => {
  it('archives, then unarchives', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })
      const base = `/workspaces/${workspace.id}/chat/sessions/${session.id}`

      const archived = await app.request(`${base}/archive`, { method: 'POST' })
      expect(archived.status).toBe(200)
      expect(((await archived.json()) as { isArchived: boolean }).isArchived).toBe(true)

      const unarchived = await app.request(`${base}/unarchive`, { method: 'POST' })
      expect(unarchived.status).toBe(200)
      expect(((await unarchived.json()) as { isArchived: boolean }).isArchived).toBe(false)
    })
  })
})

describe('DELETE /chat/sessions/:sessionId', () => {
  it('soft-deletes: 204, sets deletedAt, and the session 404s afterwards', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })
      const url = `/workspaces/${workspace.id}/chat/sessions/${session.id}`

      const res = await app.request(url, { method: 'DELETE' })
      expect(res.status).toBe(204)
      expect(findChatSessionById(db, session.id)?.deletedAt).not.toBeNull()

      const after = await app.request(url)
      expect(after.status).toBe(404)
    })
  })
})
