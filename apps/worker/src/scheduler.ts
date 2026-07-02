// In-process cron dispatcher for Phase 1 (`docs/foundation.md §3`
// "apps/worker/src/"). Accepts a `WorkerContext` + a job list at boot;
// registers each job via `node-cron`; returns a `stopScheduler` that
// stops every task on shutdown.
//
// Jobs are NOT hard-coded here — the bootstrap in `index.ts` owns the
// list. That keeps memory/knowledge/schedules workers composable when
// they land (each domain adds its own `WorkerJob` entry).
//
// Each job's `run` is wrapped in try/catch so one job's throw doesn't
// silently kill the cron loop — failures land in `logger.error` with
// the job name + the error.

import cron from 'node-cron'
import type { WorkerContext } from './factory.js'

export interface WorkerJob {
  /** Identifier used in log entries (e.g. `'purge-deleted-chat-sessions'`). */
  readonly name: string
  /** Standard 5-field cron expression. Local timezone (host TZ). */
  readonly cron: string
  /** The job body — receives the shared context; may be sync or async. */
  readonly run: (ctx: WorkerContext) => void | Promise<void>
}

export type StopScheduler = () => void

export function startScheduler(ctx: WorkerContext, jobs: ReadonlyArray<WorkerJob>): StopScheduler {
  const tasks: Array<{ name: string; task: ReturnType<typeof cron.schedule> }> = []

  for (const job of jobs) {
    const task = cron.schedule(job.cron, async () => {
      const startedAt = Date.now()
      ctx.logger.info({ jobName: job.name }, 'worker job started')
      try {
        await job.run(ctx)
        ctx.logger.info(
          { jobName: job.name, durationMs: Date.now() - startedAt },
          'worker job completed',
        )
      } catch (err) {
        ctx.logger.error(
          { err, jobName: job.name, durationMs: Date.now() - startedAt },
          'worker job failed',
        )
      }
    })
    tasks.push({ name: job.name, task })
    ctx.logger.info({ jobName: job.name, cron: job.cron }, 'worker job registered')
  }

  return () => {
    for (const { name, task } of tasks) {
      task.stop()
      ctx.logger.info({ jobName: name }, 'worker job stopped')
    }
  }
}
