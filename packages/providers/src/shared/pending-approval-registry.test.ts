// Tests for `PendingApprovalRegistry`.
// See `docs/blueprints/providers/blueprint.md §17.3`.

import { describe, expect, it, vi } from 'vitest'
import { PendingApprovalRegistry, type PendingApprovalRecord } from './pending-approval-registry.js'

function makeRecord(overrides: Partial<PendingApprovalRecord> = {}): PendingApprovalRecord {
  return {
    approvalRequestId: 'a1',
    sessionId: 's1',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    requestedAt: new Date(),
    resolve: () => {},
    ...overrides,
  }
}

describe('PendingApprovalRegistry', () => {
  it('register then resolve calls the resolve callback with the decision', () => {
    const registry = new PendingApprovalRegistry()
    const resolve = vi.fn()
    registry.register(makeRecord({ resolve }))
    const resolved = registry.resolve('a1', { kind: 'approved' })
    expect(resolved).toBe(true)
    expect(resolve).toHaveBeenCalledWith({ kind: 'approved' })
  })

  it('resolve on a missing id returns false', () => {
    const registry = new PendingApprovalRegistry()
    expect(registry.resolve('missing', { kind: 'cancelled' })).toBe(false)
  })

  it('cancelAllForSession resolves matching approvals with kind cancelled', () => {
    const registry = new PendingApprovalRegistry()
    const resolveA = vi.fn()
    const resolveB = vi.fn()
    registry.register(makeRecord({ approvalRequestId: 'a1', sessionId: 's1', resolve: resolveA }))
    registry.register(makeRecord({ approvalRequestId: 'a2', sessionId: 's2', resolve: resolveB }))
    registry.cancelAllForSession('s1')
    expect(resolveA).toHaveBeenCalledWith({ kind: 'cancelled' })
    expect(resolveB).not.toHaveBeenCalled()
    expect(registry.has('a1')).toBe(false)
    expect(registry.has('a2')).toBe(true)
  })

  it('listPendingForSession returns only the requested session approvals', () => {
    const registry = new PendingApprovalRegistry()
    registry.register(makeRecord({ approvalRequestId: 'a1', sessionId: 's1' }))
    registry.register(makeRecord({ approvalRequestId: 'a2', sessionId: 's1' }))
    registry.register(makeRecord({ approvalRequestId: 'a3', sessionId: 's2' }))
    const forSessionOne = registry.listPendingForSession('s1')
    expect(forSessionOne.map((record) => record.approvalRequestId).sort()).toEqual(['a1', 'a2'])
  })
})
