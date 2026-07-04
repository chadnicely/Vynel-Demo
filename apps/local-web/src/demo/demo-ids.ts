// Deterministic demo-id factory ("demo-msg-1", "demo-msg-2", …). Counter-based
// so tests are reproducible; the "demo-" prefix makes fake rows unmistakable in
// devtools and impossible to confuse with real API ids after the swap.
const counters = new Map<string, number>();

export function makeDemoId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `demo-${prefix}-${next}`;
}
