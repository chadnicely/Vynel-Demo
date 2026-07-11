// Tests for `buildRoutedApprovalHandler` — the surface-up SURFACING half (channel
// push + wait-gate edges + abandonParked). RECORDING lives inside the shared
// pipeline and is covered by chat's consumer tests + the tick's end-to-end park
// test. Real SQLite for the channel enqueue; the provider is a capture stub.

import { describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { ChatTurnEvent } from '@vynel/chat'
import { seedChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import { ApprovalWaitGate } from '@vynel/orchestration'
import { buildRoutedApprovalHandler } from './build-routed-approval-handler.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

type ApprovalRequestedTurnEvent = Extract<ChatTurnEvent, { kind: 'approval-requested' }>

function makeApprovalEvent(
  overrides: Partial<ApprovalRequestedTurnEvent> = {},
): ApprovalRequestedTurnEvent {
  return {
    kind: 'approval-requested',
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
  it('parks the gate on a card and pushes it to the origin channel (workspace named, explicit-id buttons)', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannel(db)
      const waitGate = new ApprovalWaitGate()
      const handler = buildRoutedApprovalHandler({
        db,
        logger: silentLogger,
        provider: makeProviderStub(),
        workspaceName: 'vynel',
        waitGate,
        origin: {
          channel,
          externalRecipientId: 'tg-42',
          externalChatContextId: 'chat-7',
        },
      })

      handler.onApprovalRequested(makeApprovalEvent())

      expect(waitGate.isParked).toBe(true)
      const outbound = listOutboundMessagesForChannel(db, channel.id)
      expect(outbound).toHaveLength(1)
      expect(outbound[0]!.payloadKind).toBe('approval-request')
      expect(outbound[0]!.externalRecipientId).toBe('tg-42')
      expect(outbound[0]!.messageBody).toContain('Write — in vynel')
      expect(outbound[0]!.messageStructure).toContain('approval:approve:appr-1')
    })
  })

  it('parks without a channel push when the job has no origin (web-driven)', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannel(db)
      const waitGate = new ApprovalWaitGate()
      const handler = buildRoutedApprovalHandler({
        db,
        logger: silentLogger,
        provider: makeProviderStub(),
        waitGate,
      })

      handler.onApprovalRequested(makeApprovalEvent())

      expect(waitGate.isParked).toBe(true)
      expect(listOutboundMessagesForChannel(db, channel.id)).toHaveLength(0)
    })
  })

  it('resumes the gate ONLY for approvals this handler parked', () => {
    const waitGate = new ApprovalWaitGate()
    const handler = buildRoutedApprovalHandler({
      db: {} as unknown as Database, // no origin → the db is never touched
      logger: silentLogger,
      provider: makeProviderStub(),
      waitGate,
    })

    handler.onApprovalRequested(makeApprovalEvent())
    expect(waitGate.isParked).toBe(true)

    handler.onApprovalResolved({
      kind: 'approval-resolved',
      approvalRequestId: 'someone-elses',
      decision: { kind: 'approved' },
      resolvedAt: new Date(),
    })
    expect(waitGate.isParked).toBe(true)

    handler.onApprovalResolved({
      kind: 'approval-resolved',
      approvalRequestId: 'appr-1',
      decision: { kind: 'approved' },
      resolvedAt: new Date(),
    })
    expect(waitGate.isParked).toBe(false)
  })

  it('abandonParked denies everything still parked and releases the gate (turn threw mid-park)', async () => {
    const provider = makeProviderStub()
    const waitGate = new ApprovalWaitGate()
    const handler = buildRoutedApprovalHandler({
      db: {} as unknown as Database,
      logger: silentLogger,
      provider,
      waitGate,
    })

    handler.onApprovalRequested(makeApprovalEvent({ approvalRequestId: 'appr-a' }))
    handler.onApprovalRequested(makeApprovalEvent({ approvalRequestId: 'appr-b' }))
    expect(waitGate.isParked).toBe(true)

    await handler.abandonParked()

    expect(provider.respondToApprovalRequest).toHaveBeenCalledTimes(2)
    expect(provider.respondToApprovalRequest).toHaveBeenCalledWith(
      'appr-a',
      expect.objectContaining({ kind: 'denied' }),
    )
    expect(waitGate.isParked).toBe(false)
  })

  it('abandonParked tolerates an already-resolved approval (NotFound) — never throws', async () => {
    const provider = {
      respondToApprovalRequest: vi.fn(async () => {
        throw new NotFoundError('approval_request', 'appr-1')
      }),
    }
    const waitGate = new ApprovalWaitGate()
    const handler = buildRoutedApprovalHandler({
      db: {} as unknown as Database,
      logger: silentLogger,
      provider,
      waitGate,
    })

    handler.onApprovalRequested(makeApprovalEvent())
    await expect(handler.abandonParked()).resolves.toBeUndefined()
    expect(waitGate.isParked).toBe(false)
  })
})
