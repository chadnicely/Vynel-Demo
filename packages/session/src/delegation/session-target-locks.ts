// `SessionTargetLocks` — the single-writer lock registry per delegation TARGET
// (a target key is a workspace id or a spawned primary id — the same key the
// delegation pool excludes on). Sessions-surface Slice ③a: user turns into a
// spawned session and the delegation tick's routed runs write the SAME resumed
// SDK session, so both acquire here — a user turn FIFO-queues behind a running
// delegated task (locked decision 3) and the pool's claim skips targets a user
// turn holds.
//
// Sync-registration contract (the pool depends on it): `acquire` registers a
// FREE key synchronously inside the call — `isBusy`/`busyKeys` reflect the new
// holder before the returned promise settles — so the tick's synchronous claim
// loop reads a correct exclusion set on its very next iteration. Only the
// release fn's delivery rides a microtask.
//
// Phase 1 runs every producer in the ONE api process, so a Map is the whole
// transport — the DelegationCancelRegistry precedent. Genuinely stateful — the
// registry class exception.

export class SessionTargetLocks {
  // Key present = held. The array is the FIFO of waiters parked behind the
  // current holder; each entry resolves one parked `acquire` with its release.
  private readonly waitersByKey = new Map<string, Array<(release: () => void) => void>>()

  /** Acquire the target's writer lock. Resolves immediately when the key is
   *  free (registered synchronously — see the header contract), else parks
   *  FIFO behind the current holder. Resolves to the release fn (idempotent —
   *  a double release never frees a successor's hold). */
  acquire(targetKey: string): Promise<() => void> {
    const waiters = this.waitersByKey.get(targetKey)
    if (waiters === undefined) {
      this.waitersByKey.set(targetKey, [])
      return Promise.resolve(this.buildRelease(targetKey))
    }
    return new Promise((resolve) => waiters.push(resolve))
  }

  /** Whether the target currently has a holder (queued waiters imply one). */
  isBusy(targetKey: string): boolean {
    return this.waitersByKey.has(targetKey)
  }

  /** Snapshot of the currently-held keys — the pool's claim exclusion set. */
  busyKeys(): ReadonlySet<string> {
    return new Set(this.waitersByKey.keys())
  }

  private buildRelease(targetKey: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const waiters = this.waitersByKey.get(targetKey)
      if (waiters === undefined) return
      const next = waiters.shift()
      // Hand the lock to the next waiter (the key stays held), or free it.
      if (next !== undefined) next(this.buildRelease(targetKey))
      else this.waitersByKey.delete(targetKey)
    }
  }
}
