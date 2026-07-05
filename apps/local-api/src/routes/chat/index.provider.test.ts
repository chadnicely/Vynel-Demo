// Integration tests for the chat routes that reach the AI provider —
// interrupt + the /context report. Real SQLite via withTestDatabase; the
// provider registry mocked at the module boundary (the approvals route-test
// precedent), so no live SDK runtime is ever started. The DB is never mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import type { Database } from '@vynel/db'

const interruptSpy = vi.fn().mockResolvedValue(undefined)
const contextReportSpy = vi.fn().mockResolvedValue(null)
vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      interruptChatSession: interruptSpy,
      getContextReport: contextReportSpy,
    }),
  }
})

import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

beforeEach(() => {
  interruptSpy.mockReset()
  interruptSpy.mockResolvedValue(undefined)
  contextReportSpy.mockReset()
  contextReportSpy.mockResolvedValue(null)
})

function seedWorld(db: Database) {
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
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function makeSession(userId: string, workspaceId: string): NewChatSession {
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
  }
}

describe('POST /chat/sessions/:sessionId/interrupt', () => {
  it('204s and forwards the interrupt to the provider', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions/${session.id}/interrupt`,
        { method: 'POST' },
      )
      expect(res.status).toBe(204)
      expect(interruptSpy).toHaveBeenCalledWith(session.id)
    })
  })

  it('404s for an unknown session (provider never reached)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions/${randomUUID()}/interrupt`,
        { method: 'POST' },
      )
      expect(res.status).toBe(404)
      expect(interruptSpy).not.toHaveBeenCalled()
    })
  })
})

describe('GET /chat/sessions/:sessionId/context', () => {
  it("returns the provider's /context markdown for the resumed session", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      contextReportSpy.mockResolvedValue('# Context breakdown')
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions/${session.id}/context`,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ report: '# Context breakdown' })
      expect(contextReportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeSessionId: session.id,
          workspacePath: workspace.path,
        }),
      )
    })
  })

  it('returns { report: null } when the provider has no report', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        `/workspaces/${workspace.id}/chat/sessions/${session.id}/context`,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ report: null })
    })
  })
})
