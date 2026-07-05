// Unit tests for `routeRequest` — the pure request-down / report-up coordinator.
// The delegation is faked at the injection boundary (the `bridgePrimarySession`
// test precedent); no DB, no provider.

import { describe, expect, it, vi } from 'vitest'
import { ApprovalWaitGate } from './approval-wait-gate.js'
import { routeRequest, type DelegateForRouting } from './route-request.js'

const baseInput = {
  userId: 'user-1',
  parentSessionId: 'global-root-sdk-1',
  targetWorkspaceId: 'ws-a',
  targetWorkspacePath: '/ws/a',
  taskText: 'Report on project A.',
}

describe('routeRequest', () => {
  it('delegates down and reports a completed envelope with the distilled result', async () => {
    const delegate = vi.fn<DelegateForRouting>(async (input) => {
      // The coordinator maps the target workspace into the delegation scope.
      expect(input.workspaceId).toBe('ws-a')
      expect(input.workspacePath).toBe('/ws/a')
      expect(input.parentSessionId).toBe('global-root-sdk-1')
      return { reference: 'leaf-sdk-1', resultText: 'The report.' }
    })

    const result = await routeRequest(baseInput, { delegate })
    expect(result).toEqual({ status: 'completed', reference: 'leaf-sdk-1', result: 'The report.' })
    expect(delegate).toHaveBeenCalledOnce()
  })

  it('reports a failed envelope (not a throw) when the delegation rejects', async () => {
    const delegate: DelegateForRouting = () => Promise.reject(new Error('agent not found'))
    const result = await routeRequest(baseInput, { delegate })
    expect(result).toEqual({ status: 'failed', message: 'agent not found' })
  })

  it('reports a timed-out envelope when the leaf outruns the wait budget', async () => {
    // The leaf "keeps running" — its promise never resolves within the budget.
    const delegate: DelegateForRouting = () => new Promise(() => {})
    const result = await routeRequest({ ...baseInput, timeoutMs: 20 }, { delegate })
    expect(result).toEqual({ status: 'timed-out', timeoutMs: 20 })
  })

  // ── Surface-up decision C: the wait clock suspends while an approval is parked ──

  it('suspends the wait budget while the gate is parked — a slow human decision does not time the job out', async () => {
    const waitGate = new ApprovalWaitGate()
    // Park immediately, resolve after 60ms — far past the 20ms budget. With the
    // clock suspended while parked, the delegation still completes.
    const delegate: DelegateForRouting = () =>
      new Promise((resolve) => {
        waitGate.markParked()
        setTimeout(() => {
          waitGate.markResolved()
          resolve({ reference: 'leaf-sdk-2', resultText: 'Approved and done.' })
        }, 60)
      })

    const result = await routeRequest({ ...baseInput, timeoutMs: 20 }, { delegate, waitGate })
    expect(result).toEqual({
      status: 'completed',
      reference: 'leaf-sdk-2',
      result: 'Approved and done.',
    })
  })

  it('resumes the clock with the REMAINING budget after the parked approval resolves', async () => {
    const waitGate = new ApprovalWaitGate()
    // Parked at once; after resolve the leaf keeps "running" forever — the clock
    // resumes and the remaining budget expires normally.
    const delegate: DelegateForRouting = () =>
      new Promise(() => {
        waitGate.markParked()
        setTimeout(() => waitGate.markResolved(), 30)
      })

    const result = await routeRequest({ ...baseInput, timeoutMs: 25 }, { delegate, waitGate })
    expect(result).toEqual({ status: 'timed-out', timeoutMs: 25 })
  })
})
