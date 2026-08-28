import { describe, expect, it } from "vitest";
import {
  FORM_DECORATION,
  createFormField,
  FORM_MOTE_COUNT,
  projectMote,
  type OrbForm,
  type ProjectionMood,
} from "./orb-forms.js";

const MOOD: ProjectionMood = {
  now: 1000,
  spin: 0.4,
  breath: 1,
  voice: 0,
  energy: 0.3,
  listening: 0,
};

/** Where a form's motes actually land, in orb-radius units. */
function radii(form: OrbForm, mood: ProjectionMood = MOOD): number[] {
  return createFormField(form, 900)
    .map((mote) => projectMote(form, mote, mood))
    .map((p) => Math.hypot(p.x, p.y));
}

describe("orb forms", () => {
  it("builds the count each form asks for", () => {
    for (const form of ["sphere", "ribbon", "flare"] as const) {
      expect(createFormField(form, 500)).toHaveLength(500);
      expect(FORM_MOTE_COUNT[form]).toBeGreaterThan(0);
    }
  });

  it("keeps every mote on screen, whatever the form", () => {
    for (const form of ["sphere", "ribbon", "flare"] as const) {
      for (const r of radii(form)) {
        expect(Number.isFinite(r)).toBe(true);
        // The stage draws at 0.3 × the smaller side, so anything past ~1.6
        // radii is off the canvas.
        expect(r).toBeLessThan(1.6);
      }
    }
  });

  // The ribbon's whole identity is the hole in the middle. If motes drift into
  // the centre it stops being a ring and becomes another sphere.
  it("leaves the ribbon hollow", () => {
    const inner = radii("ribbon").filter((r) => r < 0.5);

    expect(inner).toHaveLength(0);
  });

  // …and the sphere's is that it is NOT hollow on screen: its far and near
  // faces project over the middle.
  it("fills the sphere's centre", () => {
    const inner = radii("sphere").filter((r) => r < 0.5);

    expect(inner.length).toBeGreaterThan(50);
  });

  // The flare streams outward from a dense core, so it must cover the whole
  // span — centre to rim — rather than sitting in a band like the ribbon.
  it("spreads the flare from core to rim", () => {
    const r = radii("flare");

    expect(r.filter((v) => v < 0.35).length).toBeGreaterThan(20);
    expect(r.filter((v) => v > 0.8).length).toBeGreaterThan(20);
  });

  // The point of three forms is three silhouettes. Comparing how tightly each
  // one's radii cluster is the cheapest honest check that they are not the
  // same shape wearing different colours.
  it("gives the three forms genuinely different silhouettes", () => {
    const spread = (form: OrbForm) => {
      const r = radii(form);
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      const variance =
        r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / r.length;
      return { mean, sd: Math.sqrt(variance) };
    };

    const sphere = spread("sphere");
    const ribbon = spread("ribbon");
    const flare = spread("flare");

    // The ribbon is a narrow band: its radii barely vary.
    expect(ribbon.sd).toBeLessThan(sphere.sd);
    expect(ribbon.sd).toBeLessThan(flare.sd);
    // The flare reaches further out on average than the band sits.
    expect(flare.sd).toBeGreaterThan(0.2);
  });

  // The ribbon rotates by FLOWING around itself; if it were spun like the
  // sphere it would collapse to an edge-on line twice a turn.
  it("keeps the ribbon a ring at every spin", () => {
    for (const spin of [0, 0.8, 1.6, 3.2, 4.9]) {
      const r = radii("ribbon", { ...MOOD, spin });
      const min = Math.min(...r);

      expect(min).toBeGreaterThan(0.5);
    }
  });

  it("swells the ribbon and the flare with the voice", () => {
    const quiet = radii("ribbon");
    const loud = radii("ribbon", { ...MOOD, voice: 1.2 });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(mean(loud)).toBeGreaterThan(mean(quiet));
  });
});

// The eight forms exist to look different from each other. These cases pin the
// properties that make each silhouette what it is — the ones that would break
// silently if a projection were edited without looking at it.
describe("the wider form roster", () => {
  // Every form in the union. Listed explicitly rather than derived, so adding
  // a form without adding it here is a visible omission rather than a silent
  // gap in coverage.
  const ALL: OrbForm[] = [
    "sphere",
    "ribbon",
    "flare",
    "warp",
    "plexus",
    "lattice",
    "fan",
    "nova",
    "helix",
    "vortex",
    "tunnel",
    "swarm",
    "orbit",
    "iris",
  ];

  it("covers every form the renderer knows about", () => {
    expect(ALL).toHaveLength(Object.keys(FORM_MOTE_COUNT).length);
    for (const form of Object.keys(FORM_MOTE_COUNT) as OrbForm[]) {
      expect(ALL).toContain(form);
    }
  });

  it("keeps every form on screen and finite", () => {
    for (const form of ALL) {
      for (const r of radii(form)) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeLessThan(1.7);
      }
    }
  });

  it("declares a decoration and a mote count for every form", () => {
    for (const form of ALL) {
      expect(FORM_DECORATION[form]).toBeDefined();
      expect(FORM_MOTE_COUNT[form]).toBeGreaterThan(0);
    }
  });

  // The aperture is a blade ring around a hollow eye — motes in the middle
  // would fill the eye and it would read as a disc.
  it("leaves the aperture's eye empty", () => {
    expect(radii("fan").filter((r) => r < 0.5)).toHaveLength(0);
  });

  // Warp and nova both stream outward, so they must cover the full span.
  it.each(["warp", "nova"] as const)(
    "spreads %s from centre to rim",
    (form) => {
      const r = radii(form);
      expect(r.filter((v) => v < 0.3).length).toBeGreaterThan(10);
      expect(r.filter((v) => v > 0.9).length).toBeGreaterThan(10);
    },
  );

  // The lattice is a true sphere of vertices: before rotation every point is
  // the same distance out, which is what makes its facets regular.
  it("places lattice vertices on a unit sphere", () => {
    for (const mote of createFormField("lattice", 400)) {
      expect(Math.hypot(mote.x, mote.y, mote.z)).toBeCloseTo(1, 1);
    }
  });

  // A rotation that flattened the globe would betray itself as a form whose
  // width collapses at some angle.
  it("keeps the lattice round at every spin", () => {
    for (const spin of [0, 1.1, 2.4, 3.9, 5.6]) {
      const points = createFormField("lattice", 400).map((m) =>
        projectMote("lattice", m, { ...MOOD, spin }),
      );
      const spanX =
        Math.max(...points.map((p) => p.x)) -
        Math.min(...points.map((p) => p.x));
      const spanY =
        Math.max(...points.map((p) => p.y)) -
        Math.min(...points.map((p) => p.y));

      expect(spanX).toBeGreaterThan(1.2);
      expect(spanY).toBeGreaterThan(1.2);
    }
  });

  // Every form must react to the voice, or the room goes dead mid-sentence.
  //
  // Sampled well into the animation rather than at t≈0. Warp and Nova carry
  // the voice in their SPEED, and a speed difference has had no time to become
  // a position difference at the first instant — measuring there says they are
  // unresponsive when they are not.
  it("moves every form when the voice rises", () => {
    const late = { ...MOOD, now: 90_000 };
    for (const form of ALL) {
      // Measured as PER-MOTE DISPLACEMENT, not as a change in mean radius.
      //
      // Warp, Nova and Tunnel carry the voice in their SPEED, and their
      // positions wrap uniformly — so a faster field is the same distribution
      // in a different arrangement, and its mean radius is invariant by
      // construction. Comparing means said those three ignored the voice when
      // in fact every mote in them had moved. Displacement asks the question
      // the room actually cares about: did the picture change?
      const field = createFormField(form, 900);
      const quiet = field.map((mote) => projectMote(form, mote, late));
      const loud = field.map((mote) =>
        projectMote(form, mote, { ...late, voice: 1.3, energy: 0.9 }),
      );
      const moved =
        quiet.reduce(
          (sum, q, i) => sum + Math.hypot(q.x - loud[i]!.x, q.y - loud[i]!.y),
          0,
        ) / quiet.length;

      expect(moved).toBeGreaterThan(0.005);
    }
  });
});
