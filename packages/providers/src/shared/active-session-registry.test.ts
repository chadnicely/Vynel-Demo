// Tests for `ActiveSessionRegistry`.
// See `docs/blueprints/providers/blueprint.md §17.2`.

import { describe, expect, it, vi } from 'vitest'
import { ActiveSessionRegistry } from './active-session-registry.js'

const noopCancel = (): Promise<void> => Promise.resolve()

describe('ActiveSessionRegistry', () => {
  it('register then isActive returns true', () => {
    const registry = new ActiveSessionRegistry()
    registry.register({ sessionId: 's1', startedAt: new Date(), cancel: noopCancel })
    expect(registry.isActive('s1')).toBe(true)
  })

  it('unregister then isActive returns false', () => {
    const registry = new ActiveSessionRegistry()
    registry.register({ sessionId: 's1', startedAt: new Date(), cancel: noopCancel })
    registry.unregister('s1')
    expect(registry.isActive('s1')).toBe(false)
  })

  it('interrupt calls the cancel function and removes the record', async () => {
    const registry = new ActiveSessionRegistry()
    const cancel = vi.fn((): Promise<void> => Promise.resolve())
    registry.register({ sessionId: 's1', startedAt: new Date(), cancel })
    const interrupted = await registry.interrupt('s1')
    expect(interrupted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(registry.isActive('s1')).toBe(false)
  })

  it('interrupt on a missing id returns false', async () => {
    const registry = new ActiveSessionRegistry()
    expect(await registry.interrupt('missing')).toBe(false)
  })

  it('listActiveSessionIds returns all registered ids', () => {
    const registry = new ActiveSessionRegistry()
    registry.register({ sessionId: 's1', startedAt: new Date(), cancel: noopCancel })
    registry.register({ sessionId: 's2', startedAt: new Date(), cancel: noopCancel })
    expect(registry.listActiveSessionIds().sort()).toEqual(['s1', 's2'])
  })

  // Live mode switching (Chad, 2026-08-25): a change to Ask has to reach the
  // turn ALREADY RUNNING, or it only bites on the next one.
  describe('setPermissionMode', () => {
    it('pushes the new mode into the running session', async () => {
      const registry = new ActiveSessionRegistry()
      const seen: string[] = []
      registry.register({
        sessionId: 's1',
        startedAt: new Date(),
        cancel: noopCancel,
        setPermissionMode: async (mode) => {
          seen.push(mode)
        },
      })

      expect(await registry.setPermissionMode('s1', 'ask')).toBe(true)
      expect(seen).toEqual(['ask'])
    })

    // Reported, never thrown: the caller has already persisted the change, so
    // the next turn carries it regardless.
    it('answers false for a session that is not running', async () => {
      const registry = new ActiveSessionRegistry()
      expect(await registry.setPermissionMode('missing', 'ask')).toBe(false)
    })

    it('answers false when the runtime cannot switch live', async () => {
      const registry = new ActiveSessionRegistry()
      registry.register({ sessionId: 's1', startedAt: new Date(), cancel: noopCancel })
      expect(await registry.setPermissionMode('s1', 'ask')).toBe(false)
    })
  })
})
