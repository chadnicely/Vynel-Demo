// The cancel registry's contract: begin/resolve/cancel/end, unknown keys are
// not-found, and a stale handle never deregisters a live successor run.

import { describe, expect, it } from 'vitest'
import { DelegationCancelRegistry } from './delegation-cancel-registry.js'

describe('DelegationCancelRegistry', () => {
  it('cancels a registered run and hands back its learned session id', () => {
    const registry = new DelegationCancelRegistry()
    const handle = registry.begin('trace-1')
    expect(handle.isCancelRequested()).toBe(false)

    // Before the turn starts: cancellable, but no session to interrupt yet.
    expect(registry.requestCancel('trace-1')).toEqual({ found: true, sdkSessionId: null })
    expect(handle.isCancelRequested()).toBe(true)

    handle.sessionResolved('sdk-9')
    expect(registry.requestCancel('trace-1')).toEqual({ found: true, sdkSessionId: 'sdk-9' })
  })

  it('unknown or ended runs are not found', () => {
    const registry = new DelegationCancelRegistry()
    expect(registry.requestCancel('ghost')).toEqual({ found: false, sdkSessionId: null })

    const handle = registry.begin('trace-2')
    handle.end()
    handle.end() // idempotent
    expect(registry.requestCancel('trace-2')).toEqual({ found: false, sdkSessionId: null })
  })

  it('a stale handle cannot deregister a successor run under the same key', () => {
    const registry = new DelegationCancelRegistry()
    const stale = registry.begin('trace-3')
    const live = registry.begin('trace-3') // reclaim under the same correlation key
    stale.end()

    expect(registry.requestCancel('trace-3')).toEqual({ found: true, sdkSessionId: null })
    expect(live.isCancelRequested()).toBe(true)
  })
})
