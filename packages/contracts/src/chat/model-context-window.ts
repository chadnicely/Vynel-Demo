// Resolves the context-window size for a model — the denominator for both the
// chat usage chip (apps/web) and the session-continuity pressure check
// (apps/local-api, the root-as-thread swap trigger). The Claude Agent SDK doesn't
// report the window and it varies by model: 1M tokens for Opus 4.6–4.8 /
// Sonnet 4.6 / Fable / Mythos; 200k for everything else (Sonnet 4.5, Haiku,
// older). 200k is the floor default when the model is unknown (null) or
// unrecognized — a conservative denominator (it can only over-state usage %,
// never hide it; and for the swap, over-stating only makes us swap slightly
// earlier — safe). Source: platform.claude.com "Context windows".
//
// Lives in `@vynel/contracts` (the api↔web shared, db-free home) so both
// consumers share one source of truth — promoted on the second consumer per
// the contracts promotion rule (apps/local-api is the second; apps/web was first).

const ONE_MILLION_TOKENS = 1_000_000
const TWO_HUNDRED_K_TOKENS = 200_000

export function resolveContextWindow(model: string | null | undefined): number {
  if (!model) return TWO_HUNDRED_K_TOKENS
  const id = model.toLowerCase()
  if (/opus-4-[6-9]/.test(id)) return ONE_MILLION_TOKENS
  if (/sonnet-4-[6-9]/.test(id)) return ONE_MILLION_TOKENS
  if (id.includes('fable') || id.includes('mythos')) return ONE_MILLION_TOKENS
  return TWO_HUNDRED_K_TOKENS
}
