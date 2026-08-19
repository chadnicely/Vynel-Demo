import { describe, expect, it } from "vitest";
import {
  ROOT_LIST_KEY,
  emptyTreeOrder,
  sortByStoredOrder,
  withGroupPlaced,
  withWorkspacePlaced,
} from "./tree-order.js";

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("tree-order", () => {

  it("sorts by the stored order, newcomers follow in server order, vanished ids are ignored", () => {
    expect(idsOf(sortByStoredOrder(items("a", "b", "c", "d"), ["c", "gone", "a"]))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expect(idsOf(sortByStoredOrder(items("a", "b"), undefined))).toEqual(["a", "b"]);
  });

  it("placing a workspace writes the displayed sequence and pulls it out of every other list", () => {
    const start = {
      groups: [],
      workspaces: { g1: ["w1", "w2"], [ROOT_LIST_KEY]: ["w3"] },
    };
    // w3 dropped between w1 and w2 in g1 (position 1 in the sequence without it).
    const moved = withWorkspacePlaced(start, "w3", "g1", ["w1", "w2"], 1);
    expect(moved.workspaces).toEqual({ g1: ["w1", "w3", "w2"], [ROOT_LIST_KEY]: [] });

    // Reordering within a list: w2 dragged to the top of g1.
    const reordered = withWorkspacePlaced(moved, "w2", "g1", ["w1", "w3", "w2"], 0);
    expect(reordered.workspaces.g1).toEqual(["w2", "w1", "w3"]);

    // A position past the end clamps to last.
    expect(withWorkspacePlaced(moved, "w1", "g1", ["w1", "w3", "w2"], 99).workspaces.g1).toEqual([
      "w3",
      "w2",
      "w1",
    ]);
  });

  it("placing a group reorders the displayed group sequence", () => {
    const order = withGroupPlaced(emptyTreeOrder(), "g3", ["g1", "g2", "g3"], 0);
    expect(order.groups).toEqual(["g3", "g1", "g2"]);
    expect(withGroupPlaced(order, "g3", ["g3", "g1", "g2"], 1).groups).toEqual(["g1", "g3", "g2"]);
  });

});
