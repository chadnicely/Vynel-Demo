// Unit tests for `SessionTargetLocks` — pure in-memory, no DB. Pins the four
// contract points the pool + the session-turn stream depend on: immediate
// acquire with SYNCHRONOUS key registration, FIFO hand-over across queued
// waiters, idempotent release (a double release never frees a successor's
// hold), and `busyKeys`/`isBusy` mirroring the holders.

import { describe, it, expect, vi } from 'vitest'
import { SessionTargetLocks } from './session-target-locks.js'
import { LockWaitAbandonedError, LockWaitExpiredError } from '../runtime/lock-wait.js'

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

// ── The QUEUE's bound + cancel (audit R2-J) ──────────────────────────────────
// The arc bounded the turn that HOLDS a key; the waiters behind it were
// unbounded and uncancellable, so N queued turns behind one wedged holder
// waited N x the cap and a waiter whose client had gone still acquired.

describe('SessionTargetLocks — a bounded, cancellable wait', () => {
  it('a free key ignores the bound entirely — the sync registration must never be undone', async () => {
    const locks = new SessionTargetLocks()
    const alreadyGone = new AbortController()
    alreadyGone.abort()

    const release = await locks.acquire('target-a', { maxWaitMs: 1, signal: alreadyGone.signal })

    expect(locks.isBusy('target-a')).toBe(true)
    release()
    expect(locks.isBusy('target-a')).toBe(false)
  })

  it('gives up with a typed error past the bound and frees its queue slot', async () => {
    vi.useFakeTimers()
    try {
      const locks = new SessionTargetLocks()
      const releaseHolder = await locks.acquire('target-a')
      // The handler is attached BEFORE the clock moves — a rejection with no
      // reader yet is an unhandled rejection, the flake class the audit named.
      const bounded = locks.acquire('target-a', { maxWaitMs: 60_000 }).catch((err: unknown) => err)
      const patient = locks.acquire('target-a')

      await vi.advanceTimersByTimeAsync(60_000)
      await expect(bounded).resolves.toBeInstanceOf(LockWaitExpiredError)

      // The give-up left the FIFO: the holder's release reaches the NEXT
      // waiter, not a waiter nobody is behind any more.
      releaseHolder()
      const release = await patient
      expect(locks.isBusy('target-a')).toBe(true)
      release()
      expect(locks.isBusy('target-a')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an aborted waiter never acquires — the key passes to the next in line', async () => {
    const locks = new SessionTargetLocks()
    const releaseHolder = await locks.acquire('target-a')
    const clientGone = new AbortController()
    let abandonedAcquired = false
    const abandoned = locks
      .acquire('target-a', { signal: clientGone.signal })
      .then(() => {
        abandonedAcquired = true
      })
      .catch((err: unknown) => err)

    clientGone.abort()
    await expect(abandoned).resolves.toBeInstanceOf(LockWaitAbandonedError)

    const next = locks.acquire('target-a')
    releaseHolder()
    const release = await next
    expect(abandonedAcquired).toBe(false)
    release()
    expect(locks.isBusy('target-a')).toBe(false)
  })

  it('a hand-over that races the bound is handed straight back — the key never strands', async () => {
    vi.useFakeTimers()
    try {
      const locks = new SessionTargetLocks()
      const releaseHolder = await locks.acquire('target-a')
      const bounded = locks.acquire('target-a', { maxWaitMs: 60_000 }).catch((err: unknown) => err)

      // The bound fires and the holder releases into the abandoned waiter in
      // the same beat: it owns a lock nobody is waiting on.
      vi.advanceTimersByTime(60_000)
      releaseHolder()
      await expect(bounded).resolves.toBeInstanceOf(LockWaitExpiredError)
      await vi.advanceTimersByTimeAsync(0)

      expect(locks.isBusy('target-a')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounded waiters still hand over FIFO while nobody gives up', async () => {
    vi.useFakeTimers()
    try {
      const locks = new SessionTargetLocks()
      const releaseHolder = await locks.acquire('target-a')
      const order: number[] = []
      const releases: Array<() => void> = []
      const waiters = [1, 2, 3].map((n) =>
        locks.acquire('target-a', { maxWaitMs: 60_000 }).then((release) => {
          order.push(n)
          releases.push(release)
        }),
      )

      releaseHolder()
      await vi.advanceTimersByTimeAsync(0)
      expect(order).toEqual([1])
      releases[0]!()
      await vi.advanceTimersByTimeAsync(0)
      expect(order).toEqual([1, 2])
      releases[1]!()
      await vi.advanceTimersByTimeAsync(0)
      expect(order).toEqual([1, 2, 3])
      releases[2]!()
      await Promise.all(waiters)
      expect(locks.isBusy('target-a')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-announces while parked and stops the beat the moment it acquires', async () => {
    vi.useFakeTimers()
    try {
      const locks = new SessionTargetLocks()
      const releaseHolder = await locks.acquire('target-a')
      let announced = 0
      const waiting = locks.acquire('target-a', {
        maxWaitMs: 600_000,
        onStillWaiting: () => {
          announced += 1
        },
        stillWaitingIntervalMs: 1_000,
      })

      // The first frame goes out the moment the turn parks — the composer
      // reads "waiting", not "frozen".
      expect(announced).toBe(1)
      await vi.advanceTimersByTimeAsync(2_500)
      expect(announced).toBe(3)

      releaseHolder()
      const release = await waiting
      await vi.advanceTimersByTimeAsync(10_000)
      expect(announced).toBe(3)
      release()
    } finally {
      vi.useRealTimers()
    }
  })
})
