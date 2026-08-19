// The two pure halves of the constellation: WHAT it draws (turning the app's
// workspace rows into the scene's node list) and WHERE each dot goes (the
// arithmetic behind the three arrangements). Both live outside the canvas so
// the mapping and the geometry can be tested without a 2D context.

import type { SceneNode } from "./constellation-scene.js";
import { sceneNodeId } from "./constellation-node-ref.js";

export interface WorkspaceLike {
  id: string;
  name: string;
  isArchived: boolean;
}

/** Two initials for the node face — "Nicely Community" → "NC". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** The fleet's node list — the PROJECTS that are ready to work.
 *
 *  An archived room is deliberately not a dot (Chad, 2026-08-10): it cannot
 *  build, so showing it anyway makes the picture a lie.
 *
 *  `isReady` is the same guard for a second class of room that cannot build —
 *  one still waiting on setup. Nothing passes it yet: that reading needs a
 *  setup-completion stamp the workspace row does not carry here. It stays as
 *  the seam so the filter lands in one place when it does.
 *
 *  `statusOf` is the room's status from `use-workspace-status` — the same
 *  ladder the sidebar tree and the tab strip read, renamed into the scene's
 *  palette by `resolveNodeStatus`. `detailOf` carries what the tooltip would
 *  say; nothing renders it yet (D7 — no new visuals this pass). */
export function buildSceneNodes(
  workspaces: readonly WorkspaceLike[],
  statusOf: (workspaceId: string) => SceneNode["status"],
  options: {
    isReady?: (workspaceId: string) => boolean;
    detailOf?: (workspaceId: string) => SceneNode["detail"];
  } = {},
): SceneNode[] {
  return workspaces
    .filter((workspace) => !workspace.isArchived)
    .filter((workspace) => options.isReady?.(workspace.id) ?? true)
    .map((workspace) => {
      const detail = options.detailOf?.(workspace.id);
      return {
        id: sceneNodeId({ kind: "workspace", id: workspace.id }),
        name: workspace.name,
        initials: initialsOf(workspace.name),
        status: statusOf(workspace.id),
        ...(detail === undefined ? {} : { detail }),
      };
    });
}

/** Which slot each of `nextNodeIds` inherits from the previous frame, or
 *  `undefined` for a node the scene has never drawn.
 *
 *  The scene's scratch (eased positions, particle accumulators, satellites)
 *  is slot-aligned for the frame loop's sake but must FOLLOW THE NODE: the
 *  overview re-sorts by `lastMessageAt` on every turn boundary, so a
 *  same-length reorder used to hand one dot's state to another (2026-08-19
 *  audit, B7). Pure and here rather than inline in the loop so the rule is
 *  testable — happy-dom gives the scene no 2D context, so its handle is a
 *  no-op and the buffers are unreachable from a test. */
export function inheritedSlots(
  nextNodeIds: readonly string[],
  slotById: ReadonlyMap<string, number>,
): Array<number | undefined> {
  return nextNodeIds.map((id) => slotById.get(id));
}

// ── Where each dot goes ────────────────────────────────────────────
// Every arrangement below was index-linear: the Nth node simply got the Nth
// slot, whatever that cost. Orbit's lanes walked off a 1600x900 stage around
// the 9th node, Rise's fixed step hit its x-clamp and stacked dots on top of
// each other past ~10, and Constellation put twenty labels on one ring
// (2026-08-19 audit, A5-09). Each function below reproduces the prototype's
// own number EXACTLY while the count still fits, and only then folds — so
// today's picture is unchanged and a busy room stays on stage.

/** Orbit gives every node its own lane at `0.3 + 0.115·i` of the stage's
 *  smaller half-axis. The lane's VERTICAL reach is `lane · 0.82`, and a dot
 *  needs its 26px radius plus a 37px status label below that — which on a
 *  16:9 stage the NINTH lane (i = 8) exceeds, so the 9th node walks off the
 *  bottom. That is the count the audit measured (A5-09), and eight lanes is
 *  therefore what fits; past them they wrap, and the golden angle spacing the
 *  nodes keeps two lane-mates apart. */
export const ORBIT_LANE_CAP = 8;

export function orbitLaneIndex(nodeIndex: number): number {
  return nodeIndex % ORBIT_LANE_CAP;
}

/** How many distinct lanes a count actually occupies — the furniture draws
 *  one ellipse per lane rather than one per node, so wrapped lane-mates do
 *  not stroke the same ellipse twice. */
export function orbitLaneCount(nodeCount: number): number {
  return Math.min(nodeCount, ORBIT_LANE_CAP);
}

/** Rise's horizontal step: 11.5% of a 1300-wide reference band. */
export const RISE_BASE_STEP_RATIO = 0.115;
export const RISE_STEP_REFERENCE_WIDTH = 1300;
/** The x-clamp the prototype already applied — nodes never touch the edge. */
export const RISE_EDGE_MARGIN = 80;

/** The step that keeps `count` nodes inside the clamped band. Below ~10 nodes
 *  the reference step is already the smaller of the two, so `min` returns the
 *  prototype's own number and nothing moves. */
export function riseStep(count: number, stageWidth: number): number {
  const base =
    Math.min(stageWidth, RISE_STEP_REFERENCE_WIDTH) * RISE_BASE_STEP_RATIO;
  if (count < 2) return base;
  const band = Math.max(0, stageWidth - RISE_EDGE_MARGIN * 2);
  return Math.min(base, band / (count - 1));
}

/** How many dots one ring can carry before their labels touch. */
export const CONSTELLATION_RING_CAPACITY = 12;
/** Where the innermost ring sits when there is more than one, as a fraction
 *  of the outer radius. Chosen so the inner ring clears the core's orb even
 *  at the scene's smallest radius floor (130 · 0.7 = 91px against a 44px
 *  core), rather than dropping nodes into the lighthouse. */
export const CONSTELLATION_INNER_RING_SCALE = 0.7;

export interface ConstellationSlot {
  /** Fraction of the outer radii this node's ring sits at — 1 is the single
   *  ring the prototype drew. */
  radiusScale: number;
  /** Radians, from the top of the ring going clockwise. */
  angle: number;
}

/** One slot per node. At or below one ring's capacity this is exactly the
 *  prototype's `-90° + i·360°/n` on the full radius; past it the nodes split
 *  into evenly-filled concentric rings. */
export function constellationSlots(count: number): ConstellationSlot[] {
  if (count <= 0) return [];
  const ringCount = Math.max(1, Math.ceil(count / CONSTELLATION_RING_CAPACITY));
  const baseSize = Math.floor(count / ringCount);
  // The remainder rides the OUTER rings, which have the most room for it.
  const oversized = count % ringCount;

  const slots: ConstellationSlot[] = [];
  let placed = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const ringSize = baseSize + (ring >= ringCount - oversized ? 1 : 0);
    const radiusScale =
      ringCount === 1
        ? 1
        : CONSTELLATION_INNER_RING_SCALE +
          (1 - CONSTELLATION_INNER_RING_SCALE) * (ring / (ringCount - 1));
    for (let indexInRing = 0; indexInRing < ringSize; indexInRing += 1) {
      slots[placed] = {
        radiusScale,
        angle: -Math.PI / 2 + (indexInRing * 2 * Math.PI) / ringSize,
      };
      placed += 1;
    }
  }
  return slots;
}
