// `DelegationCancelRegistry` — the in-memory bridge between the user's Stop
// action and the delegation tick's running turn. The tick registers each
// claimed run under its `partialSessionId` (the same correlation key every
// other delegation surface uses) and records the RUNNING SDK session id as
// the turn learns it; the stop endpoint looks the run up, flags it cancelled,
// and interrupts that session via the provider. The tick then reads the flag
// at terminal time and fails the job instead of completing it — without the
// flag, an interrupted turn would drain "cleanly" and go green with a partial
// report (the exact wrongness this registry exists to prevent).
//
// Phase 1 runs the tick in the ONE api process, so a Map is the whole
// transport — the TurnEventBroadcaster precedent. Genuinely stateful — the
// registry class exception.

interface DelegationRun {
  sdkSessionId: string | null
  cancelRequested: boolean
}

export interface DelegationCancelHandle {
  /** The turn learned (or swapped to) its running SDK session id. */
  sessionResolved: (sdkSessionId: string) => void
  /** Read by the tick at terminal time — cancelled runs fail, never complete. */
  isCancelRequested: () => boolean
  /** The run reached a terminal state — deregister. Idempotent. */
  end: () => void
}

export interface RequestCancelResult {
  /** False when no run is registered under the key (not claimed here, or already over). */
  found: boolean
  /** The running SDK session to interrupt — null while the turn hasn't started yet
   *  (the flag alone still stops it at terminal time). */
  sdkSessionId: string | null
}

export class DelegationCancelRegistry {
  private readonly runs = new Map<string, DelegationRun>()

  begin(partialSessionId: string): DelegationCancelHandle {
    const run: DelegationRun = { sdkSessionId: null, cancelRequested: false }
    this.runs.set(partialSessionId, run)
    return {
      sessionResolved: (sdkSessionId) => {
        run.sdkSessionId = sdkSessionId
      },
      isCancelRequested: () => run.cancelRequested,
      end: () => {
        // Only remove OUR run — a crashed-and-reclaimed key must not let a
        // stale handle deregister the live successor.
        if (this.runs.get(partialSessionId) === run) this.runs.delete(partialSessionId)
      },
    }
  }

  requestCancel(partialSessionId: string): RequestCancelResult {
    const run = this.runs.get(partialSessionId)
    if (run === undefined) return { found: false, sdkSessionId: null }
    run.cancelRequested = true
    return { found: true, sdkSessionId: run.sdkSessionId }
  }
}
