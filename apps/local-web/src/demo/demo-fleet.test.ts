import { describe, expect, it } from "vitest";
import { orderFleetForTake } from "./demo-fleet.js";
import type { DemoProject } from "./demo-fleet.js";

const roster: DemoProject[] = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
  id,
  name: id.toUpperCase(),
  initials: id.toUpperCase(),
  aliases: [id],
  purpose: "",
  updates: [],
  shipped: [],
}));

// The constellation lays its ring out from the top, clockwise, so the FIRST
// and LAST slots are the two sides of the top. A product that landed at the
// bottom spent its whole moment behind the caption card.
describe("orderFleetForTake", () => {
  it("puts the take's products at both ends, which is the top of the ring", () => {
    const ordered = orderFleetForTake(roster, ["c", "f"]);
    expect(ordered[0]!.id).toBe("c");
    expect(ordered.at(-1)!.id).toBe("f");
  });

  it("keeps four products in the upper arc", () => {
    const ids = orderFleetForTake(roster, ["a", "b", "c", "d"]).map((p) => p.id);
    expect(ids.slice(0, 2)).toEqual(["a", "c"]);
    expect(ids.slice(-2)).toEqual(["d", "b"]);
  });

  it("loses nobody and repeats nobody", () => {
    const ordered = orderFleetForTake(roster, ["b", "e", "h"]);
    expect(ordered).toHaveLength(roster.length);
    expect(new Set(ordered.map((p) => p.id)).size).toBe(roster.length);
  });

  it("leaves a take that features nothing alone", () => {
    expect(orderFleetForTake(roster, []).map((p) => p.id)).toEqual(
      roster.map((p) => p.id),
    );
  });

  it("ignores a product that is not on the roster", () => {
    const ordered = orderFleetForTake(roster, ["c", "not-here"]);
    expect(ordered[0]!.id).toBe("c");
    expect(ordered).toHaveLength(roster.length);
  });
});
