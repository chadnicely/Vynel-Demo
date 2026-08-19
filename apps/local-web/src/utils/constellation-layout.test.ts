// What the constellation is told to draw, and where each dot goes.
//
// The layout half carries this slice's VISUAL-PARITY proof: the screen must
// look identical before and after (Kafi, D7 — no new visuals this pass), so
// every count-aware rule below is asserted to reproduce the prototype's own
// arithmetic exactly while the count still fits, and only then to fold.

import { describe, expect, it } from "vitest";
import {
  buildSceneNodes,
  constellationSlots,
  CONSTELLATION_RING_CAPACITY,
  inheritedSlots,
  initialsOf,
  orbitLaneCount,
  orbitLaneIndex,
  ORBIT_LANE_CAP,
  riseStep,
} from "./constellation-layout.js";

const room = (id: string, name: string, isArchived = false) => ({
  id,
  name,
  isArchived,
});

describe("initialsOf", () => {
  it("takes two initials from a multi-word name", () => {
    expect(initialsOf("Nicely Community")).toBe("NC");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(initialsOf("Evernote")).toBe("E");
  });
});

describe("buildSceneNodes", () => {
  it("draws one node per unarchived workspace", () => {
    const nodes = buildSceneNodes(
      [room("a", "Evernote"), room("b", "Letterman"), room("c", "Old", true)],
      () => "idle",
    );
    expect(nodes.map((node) => node.name)).toEqual(["Evernote", "Letterman"]);
  });

  it("mints every id through the node-ref vocabulary", () => {
    const nodes = buildSceneNodes([room("a", "Evernote")], () => "idle");
    expect(nodes[0]!.id).toBe("workspace:a");
  });

  it("gives each node the status the resolver reports", () => {
    const nodes = buildSceneNodes(
      [room("a", "Evernote"), room("b", "Letterman"), room("c", "Nicely")],
      (id) => (id === "b" ? "building" : id === "c" ? "waiting" : "idle"),
    );
    expect(nodes.map((node) => node.status)).toEqual([
      "idle",
      "building",
      "waiting",
    ]);
  });

  it("carries the detail bag when one is offered, and omits the key when not", () => {
    const [withDetail] = buildSceneNodes([room("a", "Evernote")], () => "idle", {
      detailOf: () => ({ note: "waiting on you", tasksDone: 1, tasksTotal: 3 }),
    });
    expect(withDetail!.detail).toEqual({
      note: "waiting on you",
      tasksDone: 1,
      tasksTotal: 3,
    });
    const [plain] = buildSceneNodes([room("a", "Evernote")], () => "idle");
    expect("detail" in plain!).toBe(false);
  });

  it("an empty fleet draws nothing — the core still has the stage", () => {
    expect(buildSceneNodes([], () => "idle")).toEqual([]);
  });
});

describe("inheritedSlots", () => {
  it("follows the node through a same-length reorder", () => {
    const slotById = new Map([
      ["workspace:a", 0],
      ["workspace:b", 1],
      ["workspace:c", 2],
    ]);
    expect(
      inheritedSlots(["workspace:c", "workspace:a", "workspace:b"], slotById),
    ).toEqual([2, 0, 1]);
  });

  it("keeps the survivors' scratch when the count changes", () => {
    const slotById = new Map([
      ["workspace:a", 0],
      ["workspace:b", 1],
    ]);
    expect(
      inheritedSlots(["workspace:b", "workspace:new"], slotById),
    ).toEqual([1, undefined]);
  });
});

describe("orbit lanes", () => {
  it("gives every node its own lane while they still fit the stage", () => {
    // Eight lanes fit; the 9th walks off the bottom (the count the audit
    // measured). The identity below IS today's picture, unchanged.
    expect(ORBIT_LANE_CAP).toBe(8);
    for (let i = 0; i < ORBIT_LANE_CAP; i += 1) {
      expect(orbitLaneIndex(i)).toBe(i);
    }
    expect(orbitLaneCount(ORBIT_LANE_CAP)).toBe(ORBIT_LANE_CAP);
    expect(orbitLaneCount(3)).toBe(3);
  });

  it("wraps past the cap instead of walking off the stage", () => {
    expect(orbitLaneIndex(ORBIT_LANE_CAP)).toBe(0);
    expect(orbitLaneIndex(ORBIT_LANE_CAP + 3)).toBe(3);
    expect(orbitLaneCount(20)).toBe(ORBIT_LANE_CAP);
  });
});

describe("riseStep", () => {
  const STAGE = 1600;
  // The prototype's number: 11.5% of a 1300-wide reference band.
  const PROTOTYPE_STEP = 1300 * 0.115;

  it("is the prototype's step for every count that already fits", () => {
    // The clamped band is 1440px wide, so ten nodes at 149.5px still fit.
    for (const count of [1, 2, 5, 9, 10]) {
      expect(riseStep(count, STAGE)).toBeCloseTo(PROTOTYPE_STEP, 10);
    }
  });

  it("shrinks so a busy room stays inside the clamped band", () => {
    const step = riseStep(20, STAGE);
    expect(step).toBeLessThan(PROTOTYPE_STEP);
    // 19 gaps at the new step span exactly the band the x-clamp allows, so
    // nothing reaches the clamp and nothing stacks.
    expect(step * 19).toBeCloseTo(STAGE - 160, 10);
  });

  it("uses the stage width when the stage is narrower than the reference", () => {
    expect(riseStep(1, 900)).toBeCloseTo(900 * 0.115, 10);
  });
});

describe("constellationSlots", () => {
  it("is one full-radius ring, at the prototype's angles, up to capacity", () => {
    for (const count of [1, 3, 7, CONSTELLATION_RING_CAPACITY]) {
      const slots = constellationSlots(count);
      expect(slots).toHaveLength(count);
      slots.forEach((slot, i) => {
        expect(slot.radiusScale).toBe(1);
        expect(slot.angle).toBeCloseTo(-Math.PI / 2 + (i * 2 * Math.PI) / count, 10);
      });
    }
  });

  it("splits into evenly-filled rings past capacity", () => {
    const slots = constellationSlots(20);
    expect(slots).toHaveLength(20);
    const scales = [...new Set(slots.map((slot) => slot.radiusScale))];
    expect(scales).toHaveLength(2);
    // The inner ring clears the core; the outer one keeps the full radius.
    expect(Math.min(...scales)).toBe(0.7);
    expect(Math.max(...scales)).toBe(1);
    const perRing = scales.map(
      (scale) => slots.filter((slot) => slot.radiusScale === scale).length,
    );
    expect(perRing).toEqual([10, 10]);
  });

  it("gives the remainder to the outer ring, which has the most room", () => {
    const slots = constellationSlots(13);
    const outer = slots.filter((slot) => slot.radiusScale === 1);
    const inner = slots.filter((slot) => slot.radiusScale !== 1);
    expect(inner).toHaveLength(6);
    expect(outer).toHaveLength(7);
  });

  it("an empty level asks for no slots", () => {
    expect(constellationSlots(0)).toEqual([]);
  });
});
