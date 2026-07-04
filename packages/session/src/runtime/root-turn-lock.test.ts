// Unit tests for the per-user root-turn lock (brain-tree Ch4). The firehose-safety guarantee:
// turns for one user never overlap; a failure doesn't wedge the chain; different users run free.

import { describe, expect, it } from 'vitest'
import { runUnderRootTurnLock } from './root-turn-lock.js'

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
})
