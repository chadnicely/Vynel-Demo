// The Display group — the room's presence (the orb) and its two chrome pieces.
// Mount them inside an element carrying `.display-root`, which owns the
// palette and the ground (display-root.css, loaded by DisplayOrb.vue).
export { default as DisplayOrb } from "./DisplayOrb.vue";
export { default as DisplayPanel } from "./DisplayPanel.vue";
export { default as DisplayStrip } from "./DisplayStrip.vue";
export type { DisplayPanelRow, DisplayPanelTone } from "./DisplayPanel.vue";
export { createOrbRenderer } from "./orb-renderer.js";
export type { OrbRenderer, OrbRendererOptions } from "./orb-renderer.js";
export { DEFAULT_ORB_PALETTE } from "./orb-palette.js";
export type { OrbPalette } from "./orb-palette.js";
