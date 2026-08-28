// The Display's SHAPES — what the room draws, with no colour in it at all.
//
// Shape and colour are two independent choices (see `display-colours.ts`): the
// room is whichever pair you pick, so nine shapes and nine colours are eighty
// one rooms out of eighteen definitions rather than eighty one definitions.
//
// Built for camera (Kafi, 2026-08-27): the presence is the subject, so the
// room shows no panels by default. Whether the telemetry panels are up is a
// SWITCH the user throws (the strip’s Panels pill), not a property of the
// shape — every shape works with them on or off, which is why it cannot live
// in this record.

import type { OrbForm } from "./orb-forms.js";

/** What the stage draws. */
export type DisplayStageKind =
  /** The canvas mote cloud. Which SHAPE it takes is `form`. */
  | "orb"
  /** Horizontal audio bars, in CSS. */
  | "wave";

export interface DisplayShape {
  id: string;
  /** What the picker calls it. */
  label: string;
  /** One line — what this shape IS, never what colour it is. */
  note: string;
  stage: DisplayStageKind;
  /** Which geometry the canvas cloud takes. Only read when `stage` is `"orb"`. */
  form?: OrbForm;
}

const SHAPES: readonly DisplayShape[] = [
  {
    id: "sphere",
    label: "Core",
    note: "A shell of particles inside segmented orbital rings",
    stage: "orb",
    form: "sphere",
  },
  {
    id: "flare",
    label: "Flare",
    note: "A molten centre throwing long twisted arms",
    stage: "orb",
    form: "flare",
  },
  {
    id: "ribbon",
    label: "Ribbon",
    note: "A band of light folded into a slowly turning ring",
    stage: "orb",
    form: "ribbon",
  },
  {
    id: "warp",
    label: "Warp",
    note: "Streaks tearing outward from a vanishing point",
    stage: "orb",
    form: "warp",
  },
  {
    id: "plexus",
    label: "Plexus",
    note: "A bright nucleus trailing long curling filaments",
    stage: "orb",
    form: "plexus",
  },
  {
    id: "lattice",
    label: "Lattice",
    note: "A faceted wireframe globe turning on its axis",
    stage: "orb",
    form: "lattice",
  },
  {
    id: "fan",
    label: "Aperture",
    note: "Hundreds of fine radial blades around a hollow eye",
    stage: "orb",
    form: "fan",
  },
  {
    id: "nova",
    label: "Nova",
    note: "A detonation held mid-burst inside shockwave rings",
    stage: "orb",
    form: "nova",
  },
  {
    id: "helix",
    label: "Helix",
    note: "Two strands twisting up a vertical axis, rungs between them",
    stage: "orb",
    form: "helix",
  },
  {
    id: "vortex",
    label: "Vortex",
    note: "A spiral galaxy winding in, its inside turning faster than its rim",
    stage: "orb",
    form: "vortex",
  },
  {
    id: "tunnel",
    label: "Tunnel",
    note: "A lit pipe rushing past toward a vanishing point",
    stage: "orb",
    form: "tunnel",
  },
  {
    id: "swarm",
    label: "Swarm",
    note: "Clusters wandering like a flock, never twice in one formation",
    stage: "orb",
    form: "swarm",
  },
  {
    id: "orbit",
    label: "Orrery",
    note: "Bodies on tilted tracks that cross rather than nest",
    stage: "orb",
    form: "orbit",
  },
  {
    id: "iris",
    label: "Iris",
    note: "Counter-turning bands around a pupil that opens when you speak",
    stage: "orb",
    form: "iris",
  },
  {
    id: "wave",
    label: "Waveform",
    note: "The voice as bars across the middle of the room",
    stage: "wave",
  },
];

export const DISPLAY_SHAPES = SHAPES;

export const DEFAULT_DISPLAY_SHAPE_ID = "sphere";

const BY_ID = new Map(SHAPES.map((shape) => [shape.id, shape]));

/** An unknown id resolves to the default rather than throwing — a stale value
 *  in localStorage must not be able to blank the room. */
export function resolveDisplayShape(
  id: string | null | undefined,
): DisplayShape {
  return (
    (id === null || id === undefined ? undefined : BY_ID.get(id)) ??
    BY_ID.get(DEFAULT_DISPLAY_SHAPE_ID)!
  );
}

export function isDisplayShapeId(id: string): boolean {
  return BY_ID.has(id);
}
