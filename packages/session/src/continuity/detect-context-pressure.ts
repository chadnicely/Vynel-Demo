// `detectContextPressure` — the swap-trigger signal. Given a context
// measurement (used tokens vs the model's context window), returns a
// pressure ratio + whether it has crossed the threshold. PURE + fully
// tested: it is the "tested threshold" the future hard-limit bridge keys
// off. Spec: `docs/agent-base/session-continuity.md` "Core operations" +
// "The model" (Layer 2).
//
// MEASUREMENT SOURCE (deliberate boundary): the live numbers come from
// Vynel's existing context report (`run-claude-context-report`, the
// provider's `/context` dispatch) OR the SDK result `usage` — extracted by
// the CALLER and passed in. The extraction + the swap that consumes this
// signal are the follow-up bridge unit (OUT of scope here, per the brief).
// Keeping the math pure (measurement in, signal out) makes the threshold
// unit-testable without a live SDK call.

// 85% of the window is "under pressure" — leaves headroom to distill +
// bridge before the hard limit. A conservative default; tune empirically
// with the bridge benchmark fixture (session-continuity Open #2).
export const DEFAULT_CONTEXT_PRESSURE_THRESHOLD = 0.85

export type ContextMeasurement = {
  usedTokens: number
  contextWindow: number
}

export type ContextPressure = {
  usedTokens: number
  contextWindow: number
  /** usedTokens / contextWindow, clamped to [0, 1]. 0 when the window is unknown. */
  ratio: number
  /** True once `ratio >= threshold` — the bridge should distill + swap. */
  isUnderPressure: boolean
  threshold: number
}

export function detectContextPressure(
  measurement: ContextMeasurement,
  options: { threshold?: number } = {},
): ContextPressure {
  const threshold = options.threshold ?? DEFAULT_CONTEXT_PRESSURE_THRESHOLD
  const { usedTokens, contextWindow } = measurement
  const rawRatio = contextWindow > 0 ? usedTokens / contextWindow : 0
  const ratio = Math.min(Math.max(rawRatio, 0), 1)
  return {
    usedTokens,
    contextWindow,
    ratio,
    isUnderPressure: ratio >= threshold,
    threshold,
  }
}
