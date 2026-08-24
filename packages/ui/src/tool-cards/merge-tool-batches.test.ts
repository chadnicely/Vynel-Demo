import { describe, expect, it } from "vitest";
import { mergeToolOnlyBatches } from "./merge-tool-batches.js";

describe("mergeToolOnlyBatches", () => {
  it("folds a run of text-less tool rows into the text row above", () => {
    expect(
      mergeToolOnlyBatches([
        { hasText: true, toolCalls: ["a"] },
        { hasText: false, toolCalls: ["b"] },
        { hasText: false, toolCalls: ["c"] },
      ]),
    ).toEqual([["a", "b", "c"], null, null]);
  });

  it("a new text row starts its own batch", () => {
    expect(
      mergeToolOnlyBatches([
        { hasText: true, toolCalls: ["a"] },
        { hasText: false, toolCalls: ["b"] },
        { hasText: true, toolCalls: [] },
        { hasText: false, toolCalls: ["c"] },
      ]),
    ).toEqual([["a", "b"], null, ["c"], null]);
  });

  it("a leading tool-only row anchors its own batch", () => {
    expect(
      mergeToolOnlyBatches([
        { hasText: false, toolCalls: ["a"] },
        { hasText: false, toolCalls: ["b"] },
        { hasText: true, toolCalls: [] },
      ]),
    ).toEqual([["a", "b"], null, null]);
  });

  it("a run boundary stops the merge — the next tool row anchors fresh", () => {
    expect(
      mergeToolOnlyBatches([
        { hasText: true, toolCalls: ["a"] },
        { hasText: false, toolCalls: ["b"], startsRun: true },
        { hasText: false, toolCalls: ["c"] },
      ]),
    ).toEqual([["a"], ["b", "c"], null]);
  });

  it("rows with nothing to place stay null and never become holders", () => {
    expect(
      mergeToolOnlyBatches([
        { hasText: true, toolCalls: [] },
        { hasText: false, toolCalls: [] },
        { hasText: false, toolCalls: ["a"] },
      ]),
    ).toEqual([["a"], null, null]);
  });
});