// Integration tests for the workspace-scoped approvals surface —
// `/workspaces/:workspaceId/approvals` (approvalsApp) +
// `/workspaces/:workspaceId/approval-rules` (approvalRulesApp). Full HTTP
// stack against real SQLite (withTestDatabase); the provider mocked at the
// module boundary (resolveApproval calls respondToApprovalRequest to unblock
// the paused agent). The Phase-1 resolver returns the single seeded user.
// The USER-scoped `/approvals` twin is covered in `user-scoped.test.ts`.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'

const respondSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({ respondToApprovalRequest: respondSpy }),
  }
})

import { recordApprovalRequest, saveApprovalRuleFromDecision } from '@vynel/approvals'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const logger = pino({ level: 'silent' })

beforeEach(() => {
  respondSpy.mockReset()
  respondSpy.mockResolvedValue(undefined)
})

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

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
  return { user, workspace: seedWorkspace(db, user.id) }
}

// Seed a pending card IN a workspace — with no rules seeded the op parks it
// pending without a provider call, so no live SDK is needed.
async function seedPending(
  db: Database,
  userId: string,
  workspaceId: string,
  providerApprovalId: string,
) {
  const out = await recordApprovalRequest(db, {
    providerApprovalId,
    userId,
    workspaceId,
    sessionId: 'sess-1',
    parentMessageId: 'msg-1',
    toolUseId: 'tool-1',
    providerId: 'claude',
    toolName: 'Write',
    toolInput: { path: '/tmp/foo' },
  })
  return out.request
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

describe('GET /workspaces/:workspaceId/approvals/pending', () => {
  it("returns only THIS workspace's pending cards", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const otherWorkspace = seedWorkspace(db, user.id)
      await seedPending(db, user.id, workspace.id, 'prov-here')
      await seedPending(db, user.id, otherWorkspace.id, 'prov-elsewhere')
      const res = await createApp({ db, logger }).request(
        `/workspaces/${workspace.id}/approvals/pending`,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ providerApprovalId: string; workspaceId: string }>
      expect(body).toHaveLength(1)
      expect(body[0]!.providerApprovalId).toBe('prov-here')
      expect(body[0]!.workspaceId).toBe(workspace.id)
    })
  })

  it('400 on an unknown query param (strict query schema)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const res = await createApp({ db, logger }).request(
        `/workspaces/${workspace.id}/approvals/pending?foo=1`,
      )
      expect(res.status).toBe(400)
    })
  })

  it('404 for an unknown workspace', async () => {
    await withTestDatabase(async (db) => {
      seedWorld(db)
      const res = await createApp({ db, logger }).request(
        `/workspaces/${randomUUID()}/approvals/pending`,
      )
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /workspaces/:workspaceId/approvals/recent', () => {
  it('pages the audit view with the keyset cursor (no overlap, newest first)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      await seedPending(db, user.id, workspace.id, 'prov-a')
      await seedPending(db, user.id, workspace.id, 'prov-b')
      await seedPending(db, user.id, workspace.id, 'prov-c')
      const app = createApp({ db, logger })
      const first = await app.request(`/workspaces/${workspace.id}/approvals/recent?limit=2`)
      expect(first.status).toBe(200)
      const firstPage = (await first.json()) as Array<{ id: string; requestedAt: string }>
      expect(firstPage).toHaveLength(2)
      const cursor = firstPage[1]!
      const second = await app.request(
        `/workspaces/${workspace.id}/approvals/recent?limit=2` +
          `&cursorRequestedAt=${encodeURIComponent(cursor.requestedAt)}&cursorId=${cursor.id}`,
      )
      expect(second.status).toBe(200)
      const secondPage = (await second.json()) as Array<{ id: string }>
      expect(secondPage).toHaveLength(1)
      const allIds = [...firstPage, ...secondPage].map((row) => row.id)
      expect(new Set(allIds).size).toBe(3)
    })
  })
})

describe('POST /workspaces/:workspaceId/approvals/:providerApprovalId/decide', () => {
  it('approves: 200, unblocks the provider; recent shows the resolved row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      await seedPending(db, user.id, workspace.id, 'prov-yes')
      const app = createApp({ db, logger })
      const res = await app.request(
        `/workspaces/${workspace.id}/approvals/prov-yes/decide`,
        jsonPost({ kind: 'approved' }),
      )
      expect(res.status).toBe(200)
      expect(respondSpy).toHaveBeenCalledWith('prov-yes', { kind: 'approved' })
      const body = (await res.json()) as { status: string; resolutionKind: string }
      expect(body.status).toBe('resolved')
      expect(body.resolutionKind).toBe('approved')
      const pending = await app.request(`/workspaces/${workspace.id}/approvals/pending`)
      expect(await pending.json()).toEqual([])
      const recent = (await (
        await app.request(`/workspaces/${workspace.id}/approvals/recent`)
      ).json()) as Array<{ status: string }>
      expect(recent).toHaveLength(1)
      expect(recent[0]!.status).toBe('resolved')
    })
  })

  it("404 for a card in ANOTHER workspace (boundary enforced, provider untouched)", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const otherWorkspace = seedWorkspace(db, user.id)
      await seedPending(db, user.id, otherWorkspace.id, 'prov-cross')
      const res = await createApp({ db, logger }).request(
        `/workspaces/${workspace.id}/approvals/prov-cross/decide`,
        jsonPost({ kind: 'approved' }),
      )
      expect(res.status).toBe(404)
      expect(respondSpy).not.toHaveBeenCalled()
    })
  })

  it('404 when the approval id is unknown; 409 on a double-resolve', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const app = createApp({ db, logger })
      const unknown = await app.request(
        `/workspaces/${workspace.id}/approvals/nope/decide`,
        jsonPost({ kind: 'denied', reason: 'x' }),
      )
      expect(unknown.status).toBe(404)
      await seedPending(db, user.id, workspace.id, 'prov-dup')
      const first = await app.request(
        `/workspaces/${workspace.id}/approvals/prov-dup/decide`,
        jsonPost({ kind: 'approved' }),
      )
      expect(first.status).toBe(200)
      const second = await app.request(
        `/workspaces/${workspace.id}/approvals/prov-dup/decide`,
        jsonPost({ kind: 'denied', reason: 'again' }),
      )
      expect(second.status).toBe(409)
    })
  })

  it('remember-rule on approve creates a workspace rule', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      await seedPending(db, user.id, workspace.id, 'prov-remember')
      const app = createApp({ db, logger })
      const res = await app.request(
        `/workspaces/${workspace.id}/approvals/prov-remember/decide`,
        jsonPost({ kind: 'approved', rememberRule: { kind: 'auto-approve-tool-name' } }),
      )
      expect(res.status).toBe(200)
      const rules = (await (
        await app.request(`/workspaces/${workspace.id}/approval-rules`)
      ).json()) as Array<{ matcher: { kind: string; toolName?: string }; isEnabled: boolean }>
      expect(rules).toHaveLength(1)
      expect(rules[0]!.matcher).toEqual({ kind: 'auto-approve-tool-name', toolName: 'Write' })
      expect(rules[0]!.isEnabled).toBe(true)
    })
  })
})

describe('/workspaces/:workspaceId/approval-rules', () => {
  // A rule seeded through the same core path the decide route uses.
  async function seedRule(db: Database, userId: string, workspaceId: string) {
    const sourceRequest = await seedPending(db, userId, workspaceId, randomUUID())
    return saveApprovalRuleFromDecision(db, {
      userId,
      workspaceId,
      sourceRequest,
      rememberRule: { kind: 'auto-approve-tool-name' },
    })
  }

  it("GET / lists only THIS workspace's active rules", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const otherWorkspace = seedWorkspace(db, user.id)
      const rule = await seedRule(db, user.id, workspace.id)
      const app = createApp({ db, logger })
      const here = (await (
        await app.request(`/workspaces/${workspace.id}/approval-rules`)
      ).json()) as Array<{ id: string; ruleKind: string }>
      expect(here).toHaveLength(1)
      expect(here[0]!.id).toBe(rule.id)
      expect(here[0]!.ruleKind).toBe('auto-approve-tool-name')
      const elsewhere = await app.request(`/workspaces/${otherWorkspace.id}/approval-rules`)
      expect(await elsewhere.json()).toEqual([])
    })
  })

  it('DELETE /:ruleId soft-deletes (204), then the rule is gone and a re-delete 404s', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const rule = await seedRule(db, user.id, workspace.id)
      const app = createApp({ db, logger })
      const del = await app.request(`/workspaces/${workspace.id}/approval-rules/${rule.id}`, {
        method: 'DELETE',
      })
      expect(del.status).toBe(204)
      const list = await app.request(`/workspaces/${workspace.id}/approval-rules`)
      expect(await list.json()).toEqual([])
      const again = await app.request(`/workspaces/${workspace.id}/approval-rules/${rule.id}`, {
        method: 'DELETE',
      })
      expect(again.status).toBe(404)
    })
  })

  it("DELETE 404s for another workspace's rule (no enumeration leak)", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const otherWorkspace = seedWorkspace(db, user.id)
      const foreignRule = await seedRule(db, user.id, otherWorkspace.id)
      const res = await createApp({ db, logger }).request(
        `/workspaces/${workspace.id}/approval-rules/${foreignRule.id}`,
        { method: 'DELETE' },
      )
      expect(res.status).toBe(404)
    })
  })
})
