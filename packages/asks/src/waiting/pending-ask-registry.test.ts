import { describe, it, expect, vi } from 'vitest'
import { PendingAskRegistry } from './pending-ask-registry.js'

describe('PendingAskRegistry', () => {
  it('resolves a registered waiter exactly once', () => {
    const registry = new PendingAskRegistry()
    const resolve = vi.fn()
    registry.register({ askId: 'ask-1', userId: 'u1', workspaceId: 'ws-1', turnKey: 't1', resolve })

    expect(registry.resolve('ask-1', { answered: false, reason: 'dismissed' })).toBe(true)
    expect(resolve).toHaveBeenCalledWith({ answered: false, reason: 'dismissed' })
    // Gone after resolution — a second resolve is a no-op.
    expect(registry.resolve('ask-1', { answered: false, reason: 'dismissed' })).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('resolve on an unknown id returns false', () => {
    expect(new PendingAskRegistry().resolve('nope', { answered: false, reason: 'expired' })).toBe(
      false,
    )
  })

  it('cancelForTurn cancels ONLY that turn — a concurrent same-workspace turn is untouched', () => {
    const registry = new PendingAskRegistry()
    const ownTurn = vi.fn()
    const siblingSameWorkspace = vi.fn()
    const globalTurn = vi.fn()
    registry.register({ askId: 'a', userId: 'u1', workspaceId: 'ws-1', turnKey: 't1', resolve: ownTurn })
    // The reviewer's S2 case: another turn in the SAME workspace must survive.
    registry.register({
      askId: 'b',
      userId: 'u1',
      workspaceId: 'ws-1',
      turnKey: 't2',
      resolve: siblingSameWorkspace,
    })
    registry.register({ askId: 'c', userId: 'u1', workspaceId: null, turnKey: 't3', resolve: globalTurn })

    const cancelled = registry.cancelForTurn('t1')
    expect(cancelled).toEqual(['a'])
    expect(ownTurn).toHaveBeenCalledWith({ answered: false, reason: 'cancelled' })
    expect(siblingSameWorkspace).not.toHaveBeenCalled()
    expect(globalTurn).not.toHaveBeenCalled()
    expect(registry.has('b')).toBe(true)
    expect(registry.has('c')).toBe(true)
  })
})
