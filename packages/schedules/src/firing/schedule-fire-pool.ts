// `ScheduleFirePool` — the PROCESS-WIDE bound on concurrent schedule fires
// (background-turns BT3). ONE instance per process, owned by the poll service
// and handed to every tick, so the bound holds ACROSS ticks: a batch still
// running when the next minute's due set arrives shares the same slots. The
// per-tick pool it replaces let a wedged batch and the next tick's batch stack
// to twice the knob. Two rules:
//   - at most `maxConcurrentFires` fires run at once; the rest wait FIFO for a
//     freed slot;
//   - ONE fire per schedule in the pool at a time — a schedule whose fire is
//     still queued or running is not admitted again (`admit` answers null), so
//     a waiting candidate the next tick re-lists never queues twice, and an
//     every-minute schedule with a slow turn cannot fill every slot with
//     copies of itself parked on its own workspace lock.
// In-process only — Phase 1 runs every producer in the ONE api process (the
// `SessionTargetLocks` precedent). Genuinely stateful: the registry class
// exception.

// The leaf's fallback when the owner names no bound — the same value the
// delegation pool + `VYNEL_MAX_CONCURRENT_DELEGATIONS` default to (3 live
// provider sessions, Chad 2026-07-21). Production always passes the env knob.
const DEFAULT_MAX_CONCURRENT_FIRES = 3

export class ScheduleFirePool {
  private readonly slotWaiters: Array<() => void> = []
  private readonly scheduleIdsInPool = new Set<string>()
  private activeCount = 0

  constructor(readonly maxConcurrentFires: number = DEFAULT_MAX_CONCURRENT_FIRES) {
    if (!Number.isInteger(maxConcurrentFires) || maxConcurrentFires < 1) {
      throw new Error(
        `ScheduleFirePool: maxConcurrentFires must be a positive integer, got ${maxConcurrentFires}`,
      )
    }
  }

  /** Whether the schedule has a fire queued or running here. */
  holds(scheduleId: string): boolean {
    return this.scheduleIdsInPool.has(scheduleId)
  }

  /** How many fires hold a slot right now (queued ones are not counted). */
  get activeFireCount(): number {
    return this.activeCount
  }

  /** Queue `fire` behind the bound and resolve with its result once it has
   *  run. Answers null — nothing queued — when the schedule already has a
   *  fire in the pool. A fire that rejects still frees its slot and its
   *  schedule; the rejection reaches the caller. */
  admit<T>(scheduleId: string, fire: () => Promise<T>): Promise<T> | null {
    if (this.scheduleIdsInPool.has(scheduleId)) return null
    this.scheduleIdsInPool.add(scheduleId)
    return this.acquireSlot()
      .then(fire)
      .finally(() => {
        this.scheduleIdsInPool.delete(scheduleId)
        this.releaseSlot()
      })
  }

  private acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrentFires) {
      this.activeCount += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => this.slotWaiters.push(resolve))
  }

  private releaseSlot(): void {
    const next = this.slotWaiters.shift()
    // Hand the slot straight to the next waiter (the count stays), or free it.
    if (next !== undefined) next()
    else this.activeCount -= 1
  }
}
