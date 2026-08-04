// The surviving half of the old fold suite (persona-sessions B2): the event
// fold moved to `applyChatTurnEvent` + `liveEntriesFromTurnView` (see
// `../activity/turn-view-entries.test.ts` for the ported cases); only the
// settled/overlay merge lives here now.

import { describe, expect, it } from "vitest";
import { mergeTraceEntries, type LiveTraceEntry } from "./fold-trace-stream.js";

function entry(id: string, body: string): LiveTraceEntry {
  return { id, role: "assistant", sourceKind: null, sourceLabel: null, body, toolCalls: [] };
}

describe("mergeTraceEntries", () => {
  it("settled rows win by id; overlay-only rows append", () => {
    const settled = [entry("a", "settled A"), entry("b", "settled B")];
    const overlay = [entry("a", "live A (older)"), entry("c", "live C")];

    const merged = mergeTraceEntries(settled, overlay);
    expect(merged.map((row) => [row.id, row.body])).toEqual([
      ["a", "settled A"],
      ["b", "settled B"],
      ["c", "live C"],
    ]);
  });
});
