// Unit tests for the per-user root-turn lock (brain-tree Ch4). The firehose-safety guarantee:
// turns for one user never overlap; a failure doesn't wedge the chain; different users run free.

import { describe, expect, it } from 'vitest'
import { isRootTurnLockBusy, rootTurnLockKey, runUnderRootTurnLock } from './root-turn-lock.js'

describe('runUnderRootTurnLock', () => {
  it('serializes turns for the same user — the second never starts until the first ends', async () => {
    const events: string[] = []
    const turn = (label: string, yields: number) => async () => {
      events.push(`${label}:start`)
      for (let i = 0; i < yields; i++) await Promise.resolve() // interleave points the lock must hold across
      events.push(`${label}:end`)
    }
    const first = runUnderRootTurnLock('user-1', turn('a', 3))
    const second = runUnderRootTurnLock('user-1', turn('b', 0))
    await Promise.all([first, second])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('a failed turn does not wedge the chain — the next turn still runs', async () => {
    const events: string[] = []
    const failing = runUnderRootTurnLock('user-2', async () => {
      events.push('fail')
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    await runUnderRootTurnLock('user-2', async () => {
      events.push('next')
    })
    expect(events).toEqual(['fail', 'next'])
  })

  it('runs different users concurrently — the lock is per-user', async () => {
    const events: string[] = []
    let releaseFirst: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const blocked = runUnderRootTurnLock('user-a', async () => {
      events.push('a:start')
      await blocker
      events.push('a:end')
    })
    await runUnderRootTurnLock('user-b', async () => {
      events.push('b') // a different user must NOT wait behind user-a's blocked turn
    })
    expect(events).toEqual(['a:start', 'b'])
    releaseFirst()
    await blocked
    expect(events).toEqual(['a:start', 'b', 'a:end'])
  })

  it('isRootTurnLockBusy: true while a turn holds OR queues on the key, false once every turn settled', async () => {
    let releaseFirst: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    expect(isRootTurnLockBusy('user-busy')).toBe(false)
    const first = runUnderRootTurnLock('user-busy', () => blocker)
    expect(isRootTurnLockBusy('user-busy')).toBe(true)
    // A second arrival QUEUES — the key stays busy for it too (the sentinel's
    // whole point: the composer learns it is waiting, not frozen).
    const second = runUnderRootTurnLock('user-busy', async () => {})
    releaseFirst()
    await first
    // Only the queued turn remains → still busy…
    expect(isRootTurnLockBusy('user-busy')).toBe(true)
    await second
    // …and the count reaches zero when the tail settles (a microtask after the
    // caller's promise resolves).
    await Promise.resolve()
    expect(isRootTurnLockBusy('user-busy')).toBe(false)
    // Another user's key was never busy.
    expect(isRootTurnLockBusy('user-elsewhere')).toBe(false)
  })

  it('isRootTurnLockBusy clears after a FAILED turn too — a failure never leaves the key reading busy', async () => {
    await expect(
      runUnderRootTurnLock('user-fails', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await Promise.resolve()
    expect(isRootTurnLockBusy('user-fails')).toBe(false)
  })

  it('rootTurnLockKey: the user id for the global conversation, the :voice suffix for the spoken twin', () => {
    expect(rootTurnLockKey('u1', false)).toBe('u1')
    expect(rootTurnLockKey('u1', true)).toBe('u1:voice')
  })
})
