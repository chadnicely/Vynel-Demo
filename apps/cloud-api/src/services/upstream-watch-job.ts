// The hub's "cron" for the upstream-drift check (Chad's call, 2026-08-02:
// the watch runs ON the cloud server, not as a desktop schedule): an
// in-process daily timer around `@vynel/registry`'s
// `checkUpstreamAgainstPin`, with the latest report held in memory for the
// /admin/upstream-watch route (the portal's drift banner). In-memory on
// purpose — the report is re-derivable every run and worthless after a
// restart-plus-one-day, so a table would be state for state's sake.
//
// The manifest is re-read from disk on EVERY run, so a re-pin (which edits
// the file) takes effect without a restart.

import { readFile } from 'node:fs/promises'
import type { StructuralLogger } from '@vynel/logger'
import { checkUpstreamAgainstPin } from '@vynel/registry'
import type { UpstreamWatchManifest, UpstreamWatchReport } from '@vynel/registry'

export type UpstreamWatchState = {
  /** null until the first run completes. */
  report: UpstreamWatchReport | null
  /** The last run's failure (network/git down) — the report keeps its last
   * good value so the portal never trades a real verdict for an error. */
  lastError: string | null
  lastRunAt: string | null
}

export type UpstreamWatchJob = {
  state(): UpstreamWatchState
  runNow(): Promise<UpstreamWatchState>
  stop(): void
}

export function startUpstreamWatchJob(options: {
  manifestPath: string
  intervalMs: number
  logger: StructuralLogger
}): UpstreamWatchJob {
  const current: UpstreamWatchState = { report: null, lastError: null, lastRunAt: null }

  const run = async (): Promise<UpstreamWatchState> => {
    current.lastRunAt = new Date().toISOString()
    try {
      const manifest = JSON.parse(
        await readFile(options.manifestPath, 'utf8'),
      ) as UpstreamWatchManifest
      const report = await checkUpstreamAgainstPin(manifest)
      current.report = report
      current.lastError = null
      options.logger.info(
        { movedCount: report.movedCount, upstreamHeadSha: report.upstreamHeadSha },
        report.movedCount > 0 ? 'upstream watch: drift detected' : 'upstream watch: pinned',
      )
    } catch (error) {
      current.lastError = error instanceof Error ? error.message : String(error)
      options.logger.warn({ error: current.lastError }, 'upstream watch run failed')
    }
    return { ...current }
  }

  // First check shortly after boot (not synchronously — boot must not wait
  // on a git clone), then the daily cadence.
  const initialTimer = setTimeout(() => void run(), 15_000)
  const timer = setInterval(() => void run(), options.intervalMs)
  // Timers must never hold the process open past a shutdown signal.
  initialTimer.unref()
  timer.unref()

  return {
    state: () => ({ ...current }),
    runNow: run,
    stop: () => {
      clearTimeout(initialTimer)
      clearInterval(timer)
    },
  }
}
