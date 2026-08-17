// Sequential action batching, shared by both act tools so their semantics
// can't drift: click → type → press enter in ONE tool call instead of three
// round-trips (each round-trip is a full model turn — batching is the single
// biggest latency win available to desktop control).
//
// SAFETY IS UNCHANGED BY BATCHING: the batch runner performs no authorization
// itself — it invokes the SAME per-action execution path a single call takes,
// so every item re-resolves its target, re-authorizes against the plan
// envelope, and re-runs the password-control guard. A batch
// is a convenience over N calls, never a way to act once and reuse the check.
//
// STOP ON FIRST FAILURE: the desktop is stateful — if step 2 didn't happen,
// step 3 would act on a screen the model never saw. The response always says
// exactly which steps ran, which one stopped it, and which never ran, so the
// model can re-observe and resume rather than guess.

import type { McpToolContent } from '@vynel/mcp-contract'

export type BatchStepResult = { ok: boolean; detail: string }

/** Why a batch stopped early — a failure is the model's problem to recover from,
 *  a deadline is the batch protecting the user from itself. */
export type BatchStopReason = 'step-failed' | 'deadline'

export type ActionBatchOutcome = {
  results: BatchStepResult[]
  /** 0-based index of the step that FAILED. Null when nothing failed — which
   *  includes both "every step ran" and "the deadline cut it short"; read
   *  `stopReason` to tell those apart. */
  failedAt: number | null
  /** Steps never attempted because an earlier one stopped the batch. */
  skipped: number
  /** Absent when every step ran. */
  stopReason?: BatchStopReason
}

export const MAX_BATCH_ACTIONS = 20

/**
 * The longest a whole batch may keep the desktop, checked BETWEEN steps.
 *
 * WHY a deadline and not a stop signal. The user's Stop aborts the model loop,
 * not an in-flight tool handler, so a running batch is un-interruptible: at 20
 * actions × a 15 s per-action bound that is up to five minutes of clicking after
 * the user asked it to stop. The obvious fix — check the MCP request's
 * `AbortSignal` between steps — does not work: the handler does receive an
 * `extra.signal`, but cancelling the call rejects only the CALLER's promise
 * while the server-side handler runs to completion and never sees `aborted`
 * (measured against the shipped SDK, 2026-08-11). A predicate on it would be
 * decoration.
 *
 * So the honest bound is time. This does not make Stop instant; it caps how long
 * Stop can be ignored — the difference between "a few seconds" and "minutes".
 * Generous enough that an ordinary batch (click, type, press enter) never sees
 * it, and it is only ever consulted between actions: interrupting mid-action
 * would strand a half-typed field, which is worse than finishing the keystroke.
 */
export const MAX_BATCH_WALL_CLOCK_MS = 45_000

export type RunActionBatchOptions<T> = {
  /**
   * Ran after a successful step, before the next one — the seam where a caller
   * puts back what the model round-trip used to provide between separate calls
   * (the coordinate path waits for the foreground to settle so the next step's
   * focus probe reads the post-click world). Never called after the last step.
   */
  betweenSteps?: (justRan: T, index: number) => Promise<void>
  /** Injected so the deadline is testable without waiting in real time. */
  now?: () => number
  /** Overrides `MAX_BATCH_WALL_CLOCK_MS` (tests; not a tool parameter — the
   *  model must not be able to widen its own bound). */
  wallClockMs?: number
}

export async function runActionBatch<T>(
  items: readonly T[],
  runStep: (item: T, index: number) => Promise<BatchStepResult>,
  options: RunActionBatchOptions<T> = {},
): Promise<ActionBatchOutcome> {
  const now = options.now ?? Date.now
  const budgetMs = options.wallClockMs ?? MAX_BATCH_WALL_CLOCK_MS
  const startedAt = now()
  const results: BatchStepResult[] = []
  for (const [index, item] of items.entries()) {
    // Checked BEFORE each step, never during one: a step already under way runs
    // to its own timeout, because abandoning a half-typed field mid-keystroke
    // leaves the screen in a state nobody planned for. The FIRST step always
    // runs — a batch that did nothing at all would report a stop the user never
    // saw a reason for.
    if (index > 0 && now() - startedAt >= budgetMs) {
      // `failedAt` stays NULL: nothing failed. Pointing it at the last step
      // would name a step that SUCCEEDED as the one that stopped the batch —
      // and the next consumer to mark `results[failedAt]` as failed would blame
      // work that was fine, which is the confusion this whole report exists to
      // prevent. `stopReason` is what distinguishes the two endings.
      return {
        results,
        failedAt: null,
        skipped: items.length - index,
        stopReason: 'deadline',
      }
    }
    let result: BatchStepResult
    try {
      result = await runStep(item, index)
    } catch (err) {
      result = { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
    results.push(result)
    if (!result.ok) {
      return {
        results,
        failedAt: index,
        skipped: items.length - index - 1,
        stopReason: 'step-failed',
      }
    }
    if (options.betweenSteps !== undefined && index < items.length - 1) {
      await options.betweenSteps(item, index)
    }
  }
  return { results, failedAt: null, skipped: 0 }
}

/** The model-facing report: numbered per-step outcomes, then the resume hint
 *  when the batch stopped early. `McpToolContent[]` (not text-only) so a
 *  caller can append an observe screenshot to the same response. */
export function buildBatchResponse(outcome: ActionBatchOutcome): {
  content: McpToolContent[]
  isError?: boolean
} {
  const lines = outcome.results.map(
    (result, index) => `${index + 1}. ${result.ok ? 'OK' : 'STOPPED'} — ${result.detail}`,
  )
  const skippedNote =
    outcome.skipped > 0
      ? ` The remaining ${outcome.skipped} action${outcome.skipped === 1 ? '' : 's'} did NOT run.`
      : ''
  // Checked BEFORE the all-ran branch: a deadline also leaves `failedAt` null
  // (nothing failed), so testing that first would report a cut-off batch as a
  // complete one — the model would carry on believing every step ran.
  if (outcome.stopReason === 'deadline') {
    return {
      content: [
        {
          type: 'text',
          text:
            `This batch hit its time limit after ${outcome.results.length} action` +
            `${outcome.results.length === 1 ? '' : 's'}, all of which succeeded.${skippedNote} ` +
            'A long batch keeps the desktop busy and cannot be interrupted while it runs, so it ' +
            'is capped. Look at the app again (snapshot_app / screenshot_app) and continue from ' +
            'where it actually got to — in a smaller batch:\n' +
            lines.join('\n'),
        },
      ],
      isError: true,
    }
  }
  if (outcome.failedAt === null) {
    return {
      content: [
        { type: 'text', text: `All ${outcome.results.length} actions ran:\n${lines.join('\n')}` },
      ],
    }
  }
  return {
    content: [
      {
        type: 'text',
        text:
          `Stopped at action ${outcome.failedAt + 1}.${skippedNote} Look at the app again ` +
          `(snapshot_app / screenshot_app) before retrying — the screen is part-way through:\n` +
          lines.join('\n'),
      },
    ],
    isError: true,
  }
}
