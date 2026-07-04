// Integration tests for the approvals HTTP surface — real SQLite via
// withTestDatabase, the provider mocked at the module boundary (resolveApproval
// calls respondToApprovalRequest to unblock the paused agent). The user is the
// Phase-1 single local user that userResolverMiddleware resolves, so seeds use
// the same getOrCreateLocalUser identity the route will see.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from '@vynel/core/users'

const respondSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({ respondToApprovalRequest: respondSpy }),
  }
})

import { recordApprovalRequest } from '@vynel/approvals'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const logger = pino({ level: 'silent' })

beforeEach(() => {
  respondSpy.mockReset()
  respondSpy.mockResolvedValue(undefined)
})

// Seed a pending card with NO workspace (a brain card) — record-approval-request
// parks it pending without a rule-eval / provider call, so no live SDK is needed.
async function seedPending(db: Database, userId: string, providerApprovalId: string) {
  await recordApprovalRequest(db, {
    providerApprovalId,
    userId,
    workspaceId: null,
    sessionId: 'sess-1',
    parentMessageId: 'msg-1',
    toolUseId: 'tool-1',
    providerId: 'claude',
    toolName: 'Write',
    toolInput: { path: '/tmp/foo' },
  })
}

describe('GET /approvals/pending', () => {
  it('returns the user pending cards (newest first, incl. brain cards)', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      await seedPending(db, user.id, 'prov-1')
      const res = await createApp({ db, logger }).request('/approvals/pending')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ providerApprovalId: string; workspaceId: string | null }>
      expect(body).toHaveLength(1)
      expect(body[0]!.providerApprovalId).toBe('prov-1')
      expect(body[0]!.workspaceId).toBeNull()
    })
  })

  it('returns an empty array when nothing is pending', async () => {
    await withTestDatabase(async (db) => {
      const res = await createApp({ db, logger }).request('/approvals/pending')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })
})

describe('POST /approvals/:providerApprovalId/decide', () => {
  it('approves: 200, unblocks the provider, resolves the row', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      await seedPending(db, user.id, 'prov-yes')
      const res = await createApp({ db, logger }).request('/approvals/prov-yes/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'approved' }),
      })
      expect(res.status).toBe(200)
      expect(respondSpy).toHaveBeenCalledWith('prov-yes', { kind: 'approved' })
      const body = (await res.json()) as { status: string; resolutionKind: string }
      expect(body.status).toBe('resolved')
      expect(body.resolutionKind).toBe('approved')
    })
  })

  it('denies: 200, stores the reason, unblocks with denied', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      await seedPending(db, user.id, 'prov-no')
      const res = await createApp({ db, logger }).request('/approvals/prov-no/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'denied', reason: 'not safe' }),
      })
      expect(res.status).toBe(200)
      expect(respondSpy).toHaveBeenCalledWith('prov-no', { kind: 'denied', reason: 'not safe' })
    })
  })

  it('404 when the approval id is unknown', async () => {
    await withTestDatabase(async (db) => {
      const res = await createApp({ db, logger }).request('/approvals/nope/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'denied', reason: 'x' }),
      })
      expect(res.status).toBe(404)
      expect(respondSpy).not.toHaveBeenCalled()
    })
  })

  it('409 on a double-resolve', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      await seedPending(db, user.id, 'prov-dup')
      const app = createApp({ db, logger })
      const first = await app.request('/approvals/prov-dup/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'approved' }),
      })
      expect(first.status).toBe(200)
      const second = await app.request('/approvals/prov-dup/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'denied', reason: 'again' }),
      })
      expect(second.status).toBe(409)
    })
  })

  it('422 on an invalid body (missing kind)', async () => {
    await withTestDatabase(async (db) => {
      const res = await createApp({ db, logger }).request('/approvals/prov-x/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'no kind' }),
      })
      expect(res.status).toBe(400)
    })
  })
})
