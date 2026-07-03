// Unit tests for `routeRequest` — the pure request-down / report-up coordinator.
// The delegation is faked at the injection boundary (the `bridgeRootSession`
// test precedent); no DB, no provider.

import { describe, expect, it, vi } from 'vitest'
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
})
