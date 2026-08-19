// `startDelegationLeaseHeartbeat` — keeps a claimed job's lease alive for the
// run's life (session-hardening A2). The claim stamped `leaseExpiresAt`; this
// extends it every `heartbeatMs` so the service's sweeper can tell "still
// running here" (fresh lease) from "the run is gone" (lapsed lease — a crash
// the boot pass has not seen, or a process too wedged to beat). Stopped in the
// tick's `finally`, so no terminal path leaks a beat onto a settled row; the
// repo guard (`status = 'claimed'`) covers the race where the row was already
// settled by someone else — the beat then logs and stands down.
//
// `unref`ed: a heartbeat must never keep the process alive on its own.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { heartbeatDelegationJob } from '@vynel/orchestration'

export interface DelegationLeaseHeartbeat {
  stop: () => void
}

export function startDelegationLeaseHeartbeat(
  db: Database,
  input: { jobId: string; leaseMs: number; heartbeatMs: number; logger: Logger },
): DelegationLeaseHeartbeat {
  const timer = setInterval(() => {
    try {
      const extended = heartbeatDelegationJob(db, input.jobId, new Date(), input.leaseMs)
      if (!extended) {
        input.logger.warn(
          { jobId: input.jobId },
          'delegation lease heartbeat: the row is no longer claimed — standing down',
        )
        clearInterval(timer)
      }
    } catch (err) {
      // A missed beat is survivable (the lease outlasts several); a run that
      // cannot write at all will lapse and be swept — which is the truth.
      input.logger.warn({ err, jobId: input.jobId }, 'delegation lease heartbeat failed')
    }
  }, input.heartbeatMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
