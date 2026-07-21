// Unit tests for `SessionTargetLocks` — pure in-memory, no DB. Pins the four
// contract points the pool + the session-turn stream depend on: immediate
// acquire with SYNCHRONOUS key registration, FIFO hand-over across queued
// waiters, idempotent release (a double release never frees a successor's
// hold), and `busyKeys`/`isBusy` mirroring the holders.

import { describe, it, expect } from 'vitest'
import { SessionTargetLocks } from './session-target-locks.js'

/** Flush pending microtasks so settled acquires observably resolve. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('SessionTargetLocks', () => {
  it('acquires a free key immediately and registers it synchronously', async () => {
    const locks = new SessionTargetLocks()
    const acquirePromise = locks.acquire('target-a')

    // The sync-registration contract: the key is busy BEFORE the promise settles.
    expect(locks.isBusy('target-a')).toBe(true)
    expect([...locks.busyKeys()]).toEqual(['target-a'])

    const release = await acquirePromise
    release()
    expect(locks.isBusy('target-a')).toBe(false)
    expect(locks.busyKeys().size).toBe(0)
  })

  it('queues waiters FIFO behind the holder and hands over one at a time', async () => {
    const locks = new SessionTargetLocks()
    const releaseHolder = await locks.acquire('target-a')

    const resolvedOrder: number[] = []
    const releases: Array<() => void> = []
    const waiters = [1, 2, 3].map((n) =>
      locks.acquire('target-a').then((release) => {
        resolvedOrder.push(n)
        releases.push(release)
      }),
    )
    await flushMicrotasks()
    expect(resolvedOrder).toEqual([]) // all parked behind the holder

    releaseHolder()
    await flushMicrotasks()
    expect(resolvedOrder).toEqual([1]) // exactly ONE hand-over per release
    expect(locks.isBusy('target-a')).toBe(true)

    releases[0]!()
    await flushMicrotasks()
    expect(resolvedOrder).toEqual([1, 2])

    releases[1]!()
    await flushMicrotasks()
    expect(resolvedOrder).toEqual([1, 2, 3])

    releases[2]!()
    await Promise.all(waiters)
    expect(locks.isBusy('target-a')).toBe(false)
  })

  it('release is idempotent — a double release frees exactly one waiter', async () => {
    const locks = new SessionTargetLocks()
    const releaseHolder = await locks.acquire('target-a')

    let firstResolved = false
    let secondResolved = false
    const first = locks.acquire('target-a').then((release) => {
      firstResolved = true
      return release
    })
    void locks.acquire('target-a').then((release) => {
      secondResolved = true
      return release
    })

    releaseHolder()
    releaseHolder() // no-op: must NOT hand over to the second waiter too
    await flushMicrotasks()
    expect(firstResolved).toBe(true)
    expect(secondResolved).toBe(false)

    const releaseFirst = await first
    releaseFirst()
    await flushMicrotasks()
    expect(secondResolved).toBe(true)
  })

  it('busyKeys reflects every held key and is independent per key', async () => {
    const locks = new SessionTargetLocks()
    const releaseA = await locks.acquire('target-a')
    const releaseB = await locks.acquire('target-b')

    expect([...locks.busyKeys()].sort()).toEqual(['target-a', 'target-b'])

    releaseA()
    expect([...locks.busyKeys()]).toEqual(['target-b'])
    expect(locks.isBusy('target-a')).toBe(false)
    expect(locks.isBusy('target-b')).toBe(true)

    releaseB()
    expect(locks.busyKeys().size).toBe(0)
  })
})
