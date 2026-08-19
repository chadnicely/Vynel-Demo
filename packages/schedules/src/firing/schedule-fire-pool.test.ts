import { describe, it, expect } from 'vitest'
import { ScheduleFirePool } from './schedule-fire-pool.js'

// The pool is a pure in-memory primitive (no DB) — the tick tests prove it
// against real rows; here the two rules in isolation: the bound (FIFO slots)
// and one fire per schedule at a time.

function controllableFire() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let started = false
  const fire = async (): Promise<string> => {
    started = true
    await gate
    return 'done'
  }
  return { fire, release, hasStarted: () => started }
}

const flushMacrotask = () => new Promise((resolve) => setImmediate(resolve))

describe('ScheduleFirePool', () => {
  it('runs at most maxConcurrentFires at once and hands freed slots on FIFO', async () => {
    const pool = new ScheduleFirePool(2)
    const fires = ['a', 'b', 'c'].map((scheduleId) => ({ scheduleId, ...controllableFire() }))
    const settled = fires.map((fire) => pool.admit(fire.scheduleId, fire.fire))
    await flushMacrotask()

    expect(fires.map((fire) => fire.hasStarted())).toEqual([true, true, false])
    expect(pool.activeFireCount).toBe(2)
    expect(fires.map((fire) => pool.holds(fire.scheduleId))).toEqual([true, true, true])

    fires[0]!.release()
    await flushMacrotask()
    expect(fires[2]!.hasStarted()).toBe(true) // the freed slot went to the waiter
    expect(pool.activeFireCount).toBe(2)
    expect(pool.holds('a')).toBe(false)

    fires[1]!.release()
    fires[2]!.release()
    expect(await Promise.all(settled)).toEqual(['done', 'done', 'done'])
    expect(pool.activeFireCount).toBe(0)
  })

  it('admits one fire per schedule at a time — a second admit while the first is queued or running answers null', async () => {
    const pool = new ScheduleFirePool(1)
    const running = controllableFire()
    const queued = controllableFire()
    const first = pool.admit('s1', running.fire)
    const second = pool.admit('s2', queued.fire)
    await flushMacrotask()

    expect(pool.admit('s1', async () => 'dup')).toBeNull() // running
    expect(pool.admit('s2', async () => 'dup')).toBeNull() // queued, not started
    expect(queued.hasStarted()).toBe(false)

    running.release()
    queued.release()
    await Promise.all([first, second])
    // Settled fires leave the pool — the schedule may be admitted again.
    expect(pool.holds('s1')).toBe(false)
    expect(await pool.admit('s1', async () => 'again')).toBe('again')
  })

  it('a fire that rejects still frees its slot and its schedule; the rejection reaches the caller', async () => {
    const pool = new ScheduleFirePool(1)
    const failing = pool.admit('s1', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    expect(pool.activeFireCount).toBe(0)
    expect(pool.holds('s1')).toBe(false)
    expect(await pool.admit('s1', async () => 'ok')).toBe('ok')
  })

  it('defaults to a bound of 3 and refuses a non-positive one', () => {
    expect(new ScheduleFirePool().maxConcurrentFires).toBe(3)
    expect(() => new ScheduleFirePool(0)).toThrow(/positive integer/)
    expect(() => new ScheduleFirePool(1.5)).toThrow(/positive integer/)
  })
})
