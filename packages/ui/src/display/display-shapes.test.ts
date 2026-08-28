import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SHAPE_ID,
  DISPLAY_SHAPES,
  isDisplayShapeId,
  resolveDisplayShape,
} from "./display-shapes.js";
import {
  DEFAULT_DISPLAY_COLOUR_ID,
  DISPLAY_COLOURS,
  isDisplayColourId,
  resolveDisplayColour,
} from "./display-colours.js";

describe("display shapes", () => {
  it("has unique ids and labels", () => {
    const ids = DISPLAY_SHAPES.map((s) => s.id);
    const labels = DISPLAY_SHAPES.map((s) => s.label);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("resolves unknown, null and undefined ids to the default", () => {
    expect(resolveDisplayShape("retired").id).toBe(DEFAULT_DISPLAY_SHAPE_ID);
    expect(resolveDisplayShape(null).id).toBe(DEFAULT_DISPLAY_SHAPE_ID);
    expect(resolveDisplayShape(undefined).id).toBe(DEFAULT_DISPLAY_SHAPE_ID);
    expect(isDisplayShapeId("retired")).toBe(false);
  });

  it("round-trips every id in the roster", () => {
    for (const shape of DISPLAY_SHAPES) {
      expect(isDisplayShapeId(shape.id)).toBe(true);
      expect(resolveDisplayShape(shape.id)).toBe(shape);
    }
  });

  it("gives every canvas shape a form, and no CSS shape one", () => {
    for (const shape of DISPLAY_SHAPES) {
      if (shape.stage === "orb") expect(shape.form).toBeDefined();
      else expect(shape.form).toBeUndefined();
    }
  });

  // The roster exists to offer different silhouettes, so no two shapes may
  // draw the same thing. Whether the panels are up is NOT part of a shape —
  // it is its own switch, and duplicating a shape to carry it would be the
  // same collapse the shape/colour split exists to avoid.
  it("never repeats a form", () => {
    const forms = DISPLAY_SHAPES.map((s) => s.form ?? s.stage);

    expect(new Set(forms).size).toBe(forms.length);
  });

  // A shape's note describes the SHAPE. If one named a colour, the two axes
  // would have started collapsing back into one.
  it("never names a colour in a shape's note", () => {
    for (const shape of DISPLAY_SHAPES) {
      for (const colour of DISPLAY_COLOURS) {
        // Whole words only: "voice" contains "ice", and a substring match
        // would fail the very notes it is meant to protect.
        const named = new RegExp(`\\b${colour.label}\\b`, "i");
        expect(shape.note).not.toMatch(named);
      }
    }
  });
});

describe("display colours", () => {
  it("has unique ids and labels", () => {
    const ids = DISPLAY_COLOURS.map((c) => c.id);
    const labels = DISPLAY_COLOURS.map((c) => c.label);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("resolves unknown, null and undefined ids to the default", () => {
    expect(resolveDisplayColour("retired").id).toBe(DEFAULT_DISPLAY_COLOUR_ID);
    expect(resolveDisplayColour(null).id).toBe(DEFAULT_DISPLAY_COLOUR_ID);
    expect(resolveDisplayColour(undefined).id).toBe(DEFAULT_DISPLAY_COLOUR_ID);
    expect(isDisplayColourId("retired")).toBe(false);
  });

  it("round-trips every id in the roster", () => {
    for (const colour of DISPLAY_COLOURS) {
      expect(isDisplayColourId(colour.id)).toBe(true);
      expect(resolveDisplayColour(colour.id)).toBe(colour);
    }
  });

  // Every colour needs its own canvas set — the orb cannot read CSS variables,
  // so a colour that shared another's palette would repaint the room but leave
  // the cloud the wrong colour.
  it("gives every colour its own orb palette", () => {
    const cores = DISPLAY_COLOURS.map((c) => c.orb.bloom.core);
    const waves = DISPLAY_COLOURS.map((c) => c.orb.wave);

    expect(new Set(cores).size).toBe(cores.length);
    expect(new Set(waves).size).toBe(waves.length);
  });

  it("gives every colour four mote tints and three ring tints", () => {
    for (const colour of DISPLAY_COLOURS) {
      expect(colour.orb.motes).toHaveLength(4);
      expect(colour.orb.rings).toHaveLength(3);
      for (const rgb of [...colour.orb.motes, ...colour.orb.rings]) {
        expect(rgb).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/);
      }
    }
  });
});

// The point of the split: every shape works with every colour, so the roster
// is the PRODUCT of the two lists, not a hand-written list of pairings.
describe("the two axes", () => {
  it("multiplies out to far more rooms than definitions", () => {
    const rooms = DISPLAY_SHAPES.length * DISPLAY_COLOURS.length;

    expect(rooms).toBeGreaterThan(
      DISPLAY_SHAPES.length + DISPLAY_COLOURS.length,
    );
    expect(rooms).toBeGreaterThanOrEqual(80);
  });
});
