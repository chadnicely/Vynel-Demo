// Unit tests for `routeRequest` — the pure request-down / report-up coordinator.
// The delegation is faked at the injection boundary (the `bridgePrimarySession`
// test precedent); no DB, no provider. The hard-cap tests pin the
// session-hardening invariant: the envelope NEVER settles before the delegate
// does — a capped turn is cancelled through `onHardCap` and then AWAITED, so
// the caller's lock outlives the turn (audit L1).

import { describe, expect, it, vi } from 'vitest'
import { ApprovalWaitGate } from './approval-wait-gate.js'
import { describeHardCap, routeRequest, type DelegateForRouting } from './route-request.js'

const baseInput = {
  userId: 'user-1',
  parentSessionId: 'global-root-sdk-1',
  targetWorkspaceId: 'ws-a',
  targetWorkspacePath: '/ws/a',
  taskText: 'Report on project A.',
}

/** A delegate that "runs" until `end()` is called — the cancel lever's target. */
function endableDelegate(): {
  delegate: DelegateForRouting
  end: (outcome: 'completed' | 'interrupted') => void
} {
  let settle: ((outcome: 'completed' | 'interrupted') => void) | undefined
  const delegate: DelegateForRouting = () =>
    new Promise((resolve, reject) => {
      settle = (outcome) =>
        outcome === 'completed'
          ? resolve({ reference: 'leaf-sdk-1', resultText: 'Partial.' })
          : reject(new Error('the routed turn was interrupted'))
    })
  return { delegate, end: (outcome) => settle?.(outcome) }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

  // ── The hard cap (session-hardening arc): cancel, then AWAIT the turn ──

  it('a capped turn is cancelled through onHardCap and the envelope settles ONLY once the delegate settles', async () => {
    const { delegate, end } = endableDelegate()
    const onHardCap = vi.fn()
    let settled = false
    const routing = routeRequest({ ...baseInput, hardCapMs: 20 }, { delegate, onHardCap }).then(
      (envelope) => {
        settled = true
        return envelope
      },
    )

    // Past the cap: the lever was pulled exactly once — and the coordinator is
    // still waiting on the turn (the old shape would have returned here).
    await wait(60)
    expect(onHardCap).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    end('interrupted')
    const result = await routing
    expect(result).toEqual({
      status: 'capped',
      hardCapMs: 20,
      message: `exceeded the ${describeHardCap(20)} cap`,
    })
  })

  it('a turn that outruns its interrupt and completes after the cap still reads capped (the cap is the honest outcome)', async () => {
    const { delegate, end } = endableDelegate()
    const routing = routeRequest({ ...baseInput, hardCapMs: 20 }, { delegate, onHardCap: () => {} })
    await wait(50)
    end('completed')
    const result = await routing
    expect(result.status).toBe('capped')
  })

  it('a delegate that settles inside the cap never pulls the lever, and the cap timer dies with the run', async () => {
    const onHardCap = vi.fn()
    const delegate: DelegateForRouting = async () => ({ reference: 'leaf-sdk-1', resultText: 'ok' })
    const result = await routeRequest({ ...baseInput, hardCapMs: 20 }, { delegate, onHardCap })
    expect(result.status).toBe('completed')
    await wait(50)
    expect(onHardCap).not.toHaveBeenCalled()
  })

  it('a throwing onHardCap is contained — the envelope still settles capped when the turn ends', async () => {
    const { delegate, end } = endableDelegate()
    const routing = routeRequest(
      { ...baseInput, hardCapMs: 20 },
      {
        delegate,
        onHardCap: () => {
          throw new Error('interrupt failed')
        },
      },
    )
    await wait(50)
    end('interrupted')
    expect((await routing).status).toBe('capped')
  })

  // ── Surface-up decision C: the cap clock suspends while an approval is parked ──

  it('suspends the cap while the gate is parked — a slow human decision does not cap the job', async () => {
    const waitGate = new ApprovalWaitGate()
    const onHardCap = vi.fn()
    // Park immediately, resolve after 60ms — far past the 20ms cap. With the
    // clock suspended while parked, the delegation still completes untouched.
    const delegate: DelegateForRouting = () =>
      new Promise((resolve) => {
        waitGate.markParked()
        setTimeout(() => {
          waitGate.markResolved()
          resolve({ reference: 'leaf-sdk-2', resultText: 'Approved and done.' })
        }, 60)
      })

    const result = await routeRequest(
      { ...baseInput, hardCapMs: 20 },
      { delegate, waitGate, onHardCap },
    )
    expect(result).toEqual({
      status: 'completed',
      reference: 'leaf-sdk-2',
      result: 'Approved and done.',
    })
    expect(onHardCap).not.toHaveBeenCalled()
  })

  it('resumes the clock with the REMAINING budget after the parked approval resolves, then caps', async () => {
    const waitGate = new ApprovalWaitGate()
    const { delegate: rawDelegate, end } = endableDelegate()
    // Parked at once; after resolve the turn keeps running — the clock resumes,
    // the remaining budget expires, the lever ends the turn.
    const delegate: DelegateForRouting = (input) => {
      waitGate.markParked()
      setTimeout(() => waitGate.markResolved(), 30)
      return rawDelegate(input)
    }
    const onHardCap = vi.fn(() => end('interrupted'))

    const result = await routeRequest(
      { ...baseInput, hardCapMs: 25 },
      { delegate, waitGate, onHardCap },
    )
    expect(onHardCap).toHaveBeenCalledOnce()
    expect(result.status).toBe('capped')
  })
})

describe('describeHardCap', () => {
  it('reads in minutes at or above one, raw milliseconds below', () => {
    expect(describeHardCap(60 * 60 * 1000)).toBe('60-minute')
    expect(describeHardCap(90_000)).toBe('2-minute')
    expect(describeHardCap(50)).toBe('50ms')
  })
})
