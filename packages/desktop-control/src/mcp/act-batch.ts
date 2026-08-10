// Sequential action batching, shared by both act tools so their semantics
// can't drift: click → type → press enter in ONE tool call instead of three
// round-trips (each round-trip is a full model turn — batching is the single
// biggest latency win available to desktop control).
//
// SAFETY IS UNCHANGED BY BATCHING: the batch runner performs no authorization
// itself — it invokes the SAME per-action execution path a single call takes,
// so every item re-resolves its target, re-authorizes against the plan
// envelope + standing grants, and re-runs the password-control guard. A batch
// is a convenience over N calls, never a way to act once and reuse the check.
//
// STOP ON FIRST FAILURE: the desktop is stateful — if step 2 didn't happen,
// step 3 would act on a screen the model never saw. The response always says
// exactly which steps ran, which one stopped it, and which never ran, so the
// model can re-observe and resume rather than guess.

export type BatchStepResult = { ok: boolean; detail: string }

export type ActionBatchOutcome = {
  results: BatchStepResult[]
  /** 0-based index of the step that stopped the batch; null = all ran. */
  failedAt: number | null
  /** Steps never attempted because an earlier one stopped the batch. */
  skipped: number
}

export const MAX_BATCH_ACTIONS = 20

export type RunActionBatchOptions<T> = {
  /**
   * Ran after a successful step, before the next one — the seam where a caller
   * puts back what the model round-trip used to provide between separate calls
   * (the coordinate path waits for the foreground to settle so the next step's
   * focus probe reads the post-click world). Never called after the last step.
   */
  betweenSteps?: (justRan: T, index: number) => Promise<void>
}

export async function runActionBatch<T>(
  items: readonly T[],
  runStep: (item: T, index: number) => Promise<BatchStepResult>,
  options: RunActionBatchOptions<T> = {},
): Promise<ActionBatchOutcome> {
  const results: BatchStepResult[] = []
  for (const [index, item] of items.entries()) {
    let result: BatchStepResult
    try {
      result = await runStep(item, index)
    } catch (err) {
      result = { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
    results.push(result)
    if (!result.ok) {
      return { results, failedAt: index, skipped: items.length - index - 1 }
    }
    if (options.betweenSteps !== undefined && index < items.length - 1) {
      await options.betweenSteps(item, index)
    }
  }
  return { results, failedAt: null, skipped: 0 }
}

/** The model-facing report: numbered per-step outcomes, then the resume hint
 *  when the batch stopped early. */
export function buildBatchResponse(outcome: ActionBatchOutcome): {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
} {
  const lines = outcome.results.map(
    (result, index) => `${index + 1}. ${result.ok ? 'OK' : 'STOPPED'} — ${result.detail}`,
  )
  if (outcome.failedAt === null) {
    return {
      content: [
        { type: 'text', text: `All ${outcome.results.length} actions ran:\n${lines.join('\n')}` },
      ],
    }
  }
  const skippedNote =
    outcome.skipped > 0
      ? ` The remaining ${outcome.skipped} action${outcome.skipped === 1 ? '' : 's'} did NOT run.`
      : ''
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
