// The Display's COLOURS, kept deliberately apart from its shapes.
//
// A colour is not a theme. Pairing one shape with one palette and calling the
// result a theme is how a roster of eight looks becomes a roster of forty that
// is really eight — the thing Kafi asked us not to build (2026-08-27). Shape
// and colour are two independent choices; the room is whatever pair you pick.
//
// Each colour carries THREE groups, because the room is painted by three
// different systems and none of them can derive the others:
//
//   surface   the readouts, panels and chrome  → CSS vars, `display-themes.css`
//   backdrop  the moving ground                → CSS vars, same file
//   orb       the canvas cloud                 → `r,g,b` bodies, here
//
// Only the orb set lives in this file as values; the other two are keyed by id
// onto `[data-display-colour]` blocks in the stylesheet, because CSS is what
// paints them.
//
// TWO RULES, both learned the hard way on camera:
//
// 1. EVERY PALETTE SPANS HUES. A single hue across all four mote tints reads
//    flat; grading them through two or three neighbouring hues is what makes
//    the object look lit rather than tinted. Slot 0 is the body colour (picked
//    ~34% of the time), 1 and 2 are the hues it grades into (~26% each), 3 is
//    the rare hot highlight (~14%) — see `pickTint` in orb-forms.
//
// 2. THE BLOOM IS SATURATED, NOT PALE. The bloom is a wide soft gradient, so a
//    near-white one is FOG: it covers the object in haze and washes it out.
//    Every `mid` and `outer` here is a deep, saturated version of the hue, and
//    only `core`/`hot` are allowed to be bright. This is the single thing that
//    kept "too much glow" coming back.

import type { OrbPalette } from "./orb-palette.js";

export interface DisplayColour {
  id: string;
  /** What the picker calls it. */
  label: string;
  /** The canvas cloud's paint set for this colour. */
  orb: OrbPalette;
}

const CYAN: DisplayColour = {
  id: "cyan",
  label: "Cyan",
  orb: {
    motes: ["79,216,255", "40,120,255", "80,255,225", "225,250,255"],
    bloom: {
      core: "150,230,255",
      hot: "200,245,255",
      mid: "40,150,255",
      outer: "20,90,220",
      edge: "6,20,60",
    },
    wave: "150,235,255",
    rings: ["90,210,255", "70,140,255", "120,255,235"],
  },
};

const AZURE: DisplayColour = {
  id: "azure",
  label: "Azure",
  orb: {
    motes: ["70,150,255", "120,95,255", "60,220,255", "220,238,255"],
    bloom: {
      core: "130,195,255",
      hot: "205,232,255",
      mid: "40,120,240",
      outer: "10,55,165",
      edge: "2,10,42",
    },
    wave: "140,195,255",
    rings: ["70,150,255", "130,110,255", "70,215,255"],
  },
};

const VIOLET: DisplayColour = {
  id: "violet",
  label: "Violet",
  orb: {
    motes: ["175,125,255", "235,95,255", "95,125,255", "240,228,255"],
    bloom: {
      core: "200,185,255",
      hot: "235,228,255",
      mid: "130,105,240",
      outer: "70,45,170",
      edge: "18,10,48",
    },
    wave: "205,180,255",
    rings: ["175,125,255", "235,100,250", "100,130,255"],
  },
};

const MAGENTA: DisplayColour = {
  id: "magenta",
  label: "Magenta",
  orb: {
    motes: ["255,85,200", "175,60,255", "70,200,255", "255,220,245"],
    bloom: {
      core: "255,150,220",
      hot: "255,215,245",
      mid: "220,60,210",
      outer: "140,20,160",
      edge: "40,4,44",
    },
    wave: "255,165,230",
    rings: ["255,95,205", "180,70,255", "80,205,255"],
  },
};

const CRIMSON: DisplayColour = {
  id: "crimson",
  label: "Crimson",
  orb: {
    motes: ["255,70,70", "255,140,50", "255,105,165", "255,220,205"],
    bloom: {
      core: "255,120,110",
      hot: "255,200,190",
      mid: "225,30,45",
      outer: "150,0,20",
      edge: "44,0,6",
    },
    wave: "255,145,135",
    rings: ["255,65,65", "255,145,55", "255,110,170"],
  },
};

const EMBER: DisplayColour = {
  id: "ember",
  label: "Ember",
  orb: {
    motes: ["255,150,45", "255,205,75", "255,80,35", "255,240,200"],
    bloom: {
      core: "255,215,150",
      hot: "255,245,220",
      mid: "255,140,40",
      outer: "190,70,10",
      edge: "50,16,2",
    },
    wave: "255,215,150",
    rings: ["255,160,50", "255,210,90", "255,85,40"],
  },
};

const GOLD: DisplayColour = {
  id: "gold",
  label: "Gold",
  orb: {
    motes: ["255,200,90", "232,150,40", "255,238,175", "255,252,230"],
    bloom: {
      core: "255,228,160",
      hot: "255,248,220",
      mid: "225,175,55",
      outer: "150,105,15",
      edge: "40,26,2",
    },
    wave: "255,230,170",
    rings: ["255,200,90", "230,150,45", "255,240,185"],
  },
};

const MINT: DisplayColour = {
  id: "mint",
  label: "Mint",
  orb: {
    motes: ["90,255,180", "60,220,235", "175,255,110", "228,255,242"],
    bloom: {
      core: "150,255,205",
      hot: "215,255,235",
      mid: "40,205,145",
      outer: "10,120,85",
      edge: "2,30,22",
    },
    wave: "160,255,210",
    rings: ["90,255,185", "60,215,240", "180,255,120"],
  },
};

// Black and white, and the hardest palette in the set. Every other colour gets
// its edge from HUE — you can see where the object stops because the glow is a
// different colour from the light. White has none of that, so a pale bloom just
// fogs the frame and swallows the piece. Its bloom is therefore barely a colour
// at all: a cold slate that falls to black almost immediately, leaving the
// motes themselves to be the white. That is what stops it washing out.
const ICE: DisplayColour = {
  id: "ice",
  label: "Ice",
  orb: {
    motes: ["205,224,246", "140,180,230", "110,142,182", "255,255,255"],
    bloom: {
      core: "240,248,255",
      hot: "255,255,255",
      mid: "96,116,146",
      outer: "38,52,78",
      edge: "10,13,18",
    },
    wave: "225,238,252",
    rings: ["205,224,246", "140,180,230", "245,250,255"],
  },
};

/** Picker order. Cyan first — it is the room as it shipped. */
export const DISPLAY_COLOURS: readonly DisplayColour[] = [
  CYAN,
  AZURE,
  VIOLET,
  MAGENTA,
  CRIMSON,
  EMBER,
  GOLD,
  MINT,
  ICE,
];

export const DEFAULT_DISPLAY_COLOUR_ID = CYAN.id;

const BY_ID = new Map(DISPLAY_COLOURS.map((colour) => [colour.id, colour]));

/** A colour id that is not in the roster resolves to cyan rather than
 *  throwing: a stale value in localStorage must not blank the room. */
export function resolveDisplayColour(
  id: string | null | undefined,
): DisplayColour {
  return (id === null || id === undefined ? undefined : BY_ID.get(id)) ?? CYAN;
}

export function isDisplayColourId(id: string): boolean {
  return BY_ID.has(id);
}
