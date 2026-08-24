// A run of tool calls with no text between them lands as MANY one-call rows
// (the SDK persists one message per provider message), which folded into many
// "1 tool call" lines instead of one compact batch (Kafi 2026-08-25, the
// Claude-Desktop shape). The VISIBLE TEXT is the boundary the base
// instruction's step-narration rule guarantees: a text-less tool-carrying row
// folds its calls into the nearest text row above it. Pure and generic — both
// transcript renderers (settled + live) feed their own row shapes through it.

export type ToolBatchItem<T> = {
  /** Whether this row shows text of its own (a step line, an answer). */
  hasText: boolean;
  toolCalls: readonly T[];
  /** True when this row must NOT merge into anything before it — a new turn,
   *  a new card, a user row, a continuation anchor. */
  startsRun?: boolean;
};

/** For each row: the calls its batch renders (its own plus every following
 *  text-less row's, until the next text row or run boundary), or `null` when
 *  this row's calls moved into an earlier batch. */
export function mergeToolOnlyBatches<T>(
  items: readonly ToolBatchItem<T>[],
): (T[] | null)[] {
  const out: (T[] | null)[] = items.map(() => null);
  let holder = -1;
  items.forEach((item, index) => {
    if (item.startsRun === true) holder = -1;
    if (item.hasText) {
      holder = index;
      if (item.toolCalls.length > 0) out[index] = [...item.toolCalls];
      return;
    }
    if (item.toolCalls.length === 0) return;
    if (holder === -1) {
      // A leading tool-only row with nothing above it anchors its own batch.
      holder = index;
      out[index] = [...item.toolCalls];
      return;
    }
    out[holder] = [...(out[holder] ?? []), ...item.toolCalls];
  });
  return out;
}
