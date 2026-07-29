import { describe, expect, it } from "vitest";
import { newlyCompletedIds } from "./recently-completed-diff.js";

describe("newlyCompletedIds", () => {
  it("celebrates only tasks seen open in the previous snapshot", () => {
    const previousOpen = new Set(["a", "b"]);
    expect(
      newlyCompletedIds(previousOpen, [{ id: "a" }, { id: "old-done" }]),
    ).toEqual(["a"]);
  });

  it("celebrates nothing on the first snapshot (no previous open set)", () => {
    expect(newlyCompletedIds(new Set(), [{ id: "x" }, { id: "y" }])).toEqual(
      [],
    );
  });
});
