// The Display group — the room's presence (the canvas cloud), its moving
// ground, its two chrome pieces, and the picker.
//
// Mount them inside an element carrying `.display-root`, which owns the
// palette and the ground (display-root.css, loaded by DisplayOrb.vue).
//
// Shape and colour are two independent rosters on purpose — see
// `display-shapes.ts` and `display-colours.ts`.
export { default as DisplayOrb } from "./DisplayOrb.vue";
export { default as DisplayPanel } from "./DisplayPanel.vue";
export { default as DisplayStrip } from "./DisplayStrip.vue";
export type { DisplayPanelRow, DisplayPanelTone } from "./DisplayPanel.vue";
export { createOrbRenderer } from "./orb-renderer.js";
export type { OrbRenderer, OrbRendererOptions } from "./orb-renderer.js";
export { DEFAULT_ORB_PALETTE } from "./orb-palette.js";
export type { OrbPalette } from "./orb-palette.js";

export { default as DisplayBackdrop } from "./DisplayBackdrop.vue";
export { default as DisplayPresence } from "./DisplayPresence.vue";
export { default as DisplayThemeMenu } from "./DisplayThemeMenu.vue";

export {
  DISPLAY_SHAPES,
  DEFAULT_DISPLAY_SHAPE_ID,
  resolveDisplayShape,
  isDisplayShapeId,
} from "./display-shapes.js";
export type { DisplayShape, DisplayStageKind } from "./display-shapes.js";

export {
  DISPLAY_COLOURS,
  DEFAULT_DISPLAY_COLOUR_ID,
  resolveDisplayColour,
  isDisplayColourId,
} from "./display-colours.js";
export type { DisplayColour } from "./display-colours.js";

export { FORM_MOTE_COUNT, FORM_DECORATION } from "./orb-forms.js";
export type { OrbForm, OrbDecoration } from "./orb-forms.js";
