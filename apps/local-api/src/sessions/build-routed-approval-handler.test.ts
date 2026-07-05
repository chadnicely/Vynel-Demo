// Tests for `buildRoutedApprovalHandler` — the surface-up record-and-park policy.
// Real SQLite (never mock the DB); the provider is a capture stub at the injection
// boundary (the fake-provider precedent).

import { describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { NormalizedSessionEvent } from '@vynel/providers'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { seedChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import { ApprovalWaitGate } from '@vynel/orchestration'
import { buildRoutedApprovalHandler } from './build-routed-approval-handler.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

type ApprovalRequestedEvent = Extract<NormalizedSessionEvent, { kind: 'approval-requested' }>

function makeApprovalEvent(overrides: Partial<ApprovalRequestedEvent> = {}): ApprovalRequestedEvent {
  return {
    kind: 'approval-requested',
    sessionId: 'ws-root-sdk-1',
    approvalRequestId: 'appr-1',
    parentMessageId: 'msg-1',
    toolName: 'Write',
    toolInput: { file_path: '/tmp/x.txt' },
    requestedAt: new Date(),
    ...overrides,
  }
}

function makeProviderStub() {
  return { respondToApprovalRequest: vi.fn(async () => {}) }
}

describe('buildRoutedApprovalHandler', () => {
  it('records the approval (workspace-scoped, user queue) and PARKS — no provider response', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedChannel(db)
      const provider = makeProviderStub()
      const waitGate = new ApprovalWaitGate()
      const handler = buildRoutedApprovalHandler({
        db,
        logger: silentLogger,
        provider,
        userId: user.id,
        workspaceId: workspace.id,
        waitGate,
      })

      await handler.onApprovalRequested(makeApprovalEvent())

      // Recorded → the web notifier's user-scoped queue sees it.
      const pending = listPendingApprovalsForUser(db, user.id)
      expect(pending).toHaveLength(1)
      expect(pending[0]!.providerApprovalId).toBe('appr-1')
      expect(pending[0]!.workspaceId).toBe(workspace.id)
      expect(pending[0]!.toolName).toBe('Write')

      // Parked: the wait budget suspends; the provider was NOT answered.
      expect(waitGate.isParked).toBe(true)
      expect(provider.respondToApprovalRequest).not.toHaveBeenCalled()
    })
  })

  it('pushes the card to the origin channel (buttons carry the explicit approval id)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace, channel } = seedChannel(db)
      const handler = buildRoutedApprovalHandler({
        db,
        logger: silentLogger,
        provider: makeProviderStub(),
        userId: user.id,
        workspaceId: workspace.id,
        waitGate: new ApprovalWaitGate(),
        origin: {
          channel,
          externalRecipientId: 'tg-42',
          externalChatContextId: 'chat-7',
        },
      })

      await handler.onApprovalRequested(makeApprovalEvent())

      const outbound = listOutboundMessagesForChannel(db, channel.id)
      expect(outbound).toHaveLength(1)
      expect(outbound[0]!.payloadKind).toBe('approval-request')
      expect(outbound[0]!.externalRecipientId).toBe('tg-42')
      expect(outbound[0]!.externalChatContextId).toBe('chat-7')
      expect(outbound[0]!.messageBody).toContain('Write')
      expect(outbound[0]!.messageStructure).toContain('approval:approve:appr-1')
    })
  })

  it('resumes the gate ONLY for approvals this handler parked', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedChannel(db)
      const waitGate = new ApprovalWaitGate()
      const handler = buildRoutedApprovalHandler({
        db,
        logger: silentLogger,
        provider: makeProviderStub(),
        userId: user.id,
        workspaceId: workspace.id,
        waitGate,
      })

      await handler.onApprovalRequested(makeApprovalEvent())
      expect(waitGate.isParked).toBe(true)

      // A resolution for an approval it never parked must not release the gate.
      await handler.onApprovalResolved({
        kind: 'approval-resolved',
        sessionId: 'ws-root-sdk-1',
        approvalRequestId: 'someone-elses',
        decision: { kind: 'approved' },
        resolvedAt: new Date(),
      })
      expect(waitGate.isParked).toBe(true)

      await handler.onApprovalResolved({
        kind: 'approval-resolved',
        sessionId: 'ws-root-sdk-1',
        approvalRequestId: 'appr-1',
        decision: { kind: 'approved' },
        resolvedAt: new Date(),
      })
      expect(waitGate.isParked).toBe(false)
    })
  })

  it('fails closed when recording throws — denies at the provider, never deadlocks', async () => {
    const provider = makeProviderStub()
    const poisonedDb = {} as unknown as Database // any DB use throws → the record fails
    const handler = buildRoutedApprovalHandler({
      db: poisonedDb,
      logger: silentLogger,
      provider,
      userId: 'user-1',
      workspaceId: 'ws-1',
      waitGate: new ApprovalWaitGate(),
    })

    await handler.onApprovalRequested(makeApprovalEvent())

    expect(provider.respondToApprovalRequest).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({ kind: 'denied' }),
    )
  })

  it('tolerates the fail-closed deny finding the approval already resolved — the turn keeps draining', async () => {
    // The auto-approve path can answer the provider BEFORE its Tx2 fails: the catch's
    // deny then gets NotFound (registry entry gone). That must not reject the drain.
    const provider = {
      respondToApprovalRequest: vi.fn(async () => {
        throw new NotFoundError('approval_request', 'appr-1')
      }),
    }
    const handler = buildRoutedApprovalHandler({
      db: {} as unknown as Database, // recording throws first
      logger: silentLogger,
      provider,
      userId: 'user-1',
      workspaceId: 'ws-1',
      waitGate: new ApprovalWaitGate(),
    })

    await expect(handler.onApprovalRequested(makeApprovalEvent())).resolves.toBeUndefined()
    expect(provider.respondToApprovalRequest).toHaveBeenCalledOnce()
  })
})
