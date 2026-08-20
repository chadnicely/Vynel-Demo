// The orb's canvas paint set. These are literal pixel values the 2D context
// mixes into gradients and additive strokes — not themeable surfaces — which is
// why they live here as `r,g,b` bodies rather than as CSS variables. The four
// SURFACE colours (accent / dim / faint / text) and the ground live in
// `display-root.css`; the two palettes are deliberately separate homes because
// the orb's four mote tints and three ring tints cannot be derived from one
// accent without losing the look.

export interface OrbPalette {
  /** Mote sprite tints, in the order the field picks them (0 = commonest). */
  motes: readonly [string, string, string, string];
  /** The bloom behind the orb, inner → outer. `hot` replaces `core` while it speaks. */
  bloom: {
    core: string;
    hot: string;
    mid: string;
    outer: string;
    edge: string;
  };
  /** The ring thrown outward on each spoken clause. */
  wave: string;
  /** The three segmented dials, outer → inner. */
  rings: readonly [string, string, string];
}

/** The demo's cyan (`.tmp/vynel-mission-control/js/hud.js`), value for value. */
export const DEFAULT_ORB_PALETTE: OrbPalette = {
  motes: ["60,200,255", "30,130,255", "120,240,255", "210,250,255"],
  bloom: {
    core: "150,230,255",
    hot: "200,245,255",
    mid: "40,150,255",
    outer: "20,90,220",
    edge: "6,20,60",
  },
  wave: "150,235,255",
  rings: ["90,210,255", "160,235,255", "120,225,255"],
};
