// The three shapes the orb can take. A form is not a restyled sphere: it
// changes where the motes LIVE and how they move, which is why each one owns
// both its field and its projection here rather than being a flag inside the
// draw loop.
//
//   sphere  a hollow shell of motes, rotating about the screen's vertical —
//           the original, and the classic Jarvis core.
//   ribbon  a face-on torus whose radius undulates, so the cloud reads as a
//           flowing band folded into a ring with a hollow middle.
//   flare   spokes of motes streaming out of a hot centre, twisted into arms.
//
// Projection is deliberately per-form. The sphere's Y-axis spin would squash a
// face-on ribbon into an edge-on line every half turn, and would smear the
// flare's arms; each form instead animates in the way its own shape reads.

import { createMoteField } from "./orb-motes.js";
import type { Mote } from "./orb-motes.js";

export type OrbForm =
  | "sphere"
  | "ribbon"
  | "flare"
  | "warp"
  | "plexus"
  | "lattice"
  | "fan"
  | "nova"
  | "helix"
  | "vortex"
  | "tunnel"
  | "swarm"
  | "orbit"
  | "iris";

/** The line work a form draws on top of its motes. Motes alone read as a
 *  cloud; these are what give each form its silhouette. */
export type OrbDecoration =
  | "none"
  /** The three segmented dials — the sphere's own. */
  | "rings"
  /** Straight tapered spokes out of the core (flare). */
  | "spokes"
  /** Long curling filaments from the nucleus (plexus). */
  | "filaments"
  /** Edges between neighbouring vertices (lattice). */
  | "edges"
  /** Dense fine blades around a hollow centre (fan). */
  | "blades"
  /** Concentric shockwave rings (nova). */
  | "shock"
  /** Ladder rungs between the two strands (helix). */
  | "rungs"
  /** Perspective rings receding to the vanishing point (tunnel). */
  | "tunnel"
  /** Tilted ellipse outlines the bodies ride (orbit). */
  | "orbits"
  /** Concentric arc segments around a pupil (iris). */
  | "arcs";

export const FORM_DECORATION: Record<OrbForm, OrbDecoration> = {
  sphere: "rings",
  ribbon: "none",
  flare: "spokes",
  warp: "none",
  plexus: "filaments",
  lattice: "edges",
  fan: "blades",
  nova: "shock",
  helix: "rungs",
  vortex: "none",
  tunnel: "tunnel",
  swarm: "none",
  orbit: "orbits",
  iris: "arcs",
};

/**
 * Where a form's glow belongs. This is a property of the GEOMETRY, not a
 * style: a hollow form given a centre-weighted bloom has its hole filled with
 * light and stops being hollow — which is exactly how Aperture ended up as a
 * white smear with its blades washed out (Kafi, 2026-08-27).
 */
export type OrbBloomShape =
  /** Ring of light at the band, dark middle. Forms with a hole. */
  | "hollow"
  /** A tight hot centre that falls away fast. Forms that stream outward. */
  | "core"
  /** A moderate centre — forms that are solid all the way through. */
  | "shell";

export const FORM_BLOOM: Record<OrbForm, OrbBloomShape> = {
  sphere: "shell",
  lattice: "shell",
  // The two with a hole in the middle.
  ribbon: "hollow",
  fan: "hollow",
  // The four lit from a point.
  flare: "core",
  warp: "core",
  nova: "core",
  plexus: "core",
  vortex: "core",
  tunnel: "core",
  swarm: "shell",
  helix: "shell",
  // Both have an empty middle their light must not fill.
  orbit: "hollow",
  iris: "hollow",
};

/** Forms whose motes are drawn as STREAKS rather than round sprites — the
 *  smear is the whole look, so it belongs to the geometry, not to a setting. */
export const FORM_STREAKS: ReadonlySet<OrbForm> = new Set<OrbForm>([
  "warp",
  "nova",
  "tunnel",
]);

/** Screen-space result, in orb-radius units (the caller scales and offsets). */
export interface ProjectedMote {
  x: number;
  y: number;
  /** 0..1, near→far. Drives size and alpha so the cloud reads as volume. */
  depth: number;
}

export interface ProjectionMood {
  now: number;
  spin: number;
  /** Overall swell — the shared breath. */
  breath: number;
  /** The live voice envelope, 0..~1.6. */
  voice: number;
  energy: number;
  listening: number;
}

/** How many motes each form wants. The ribbon is a thin band and needs fewer
 *  to read as solid; the flare's arms need enough to look continuous. */
export const FORM_MOTE_COUNT: Record<OrbForm, number> = {
  sphere: 2600,
  ribbon: 2200,
  flare: 2400,
  warp: 2800,
  plexus: 2000,
  lattice: 1400,
  fan: 2600,
  nova: 3000,
  helix: 1800,
  vortex: 3000,
  tunnel: 2400,
  swarm: 2200,
  orbit: 1600,
  iris: 2400,
};

function pickTint(roll: number): number {
  return roll < 0.14 ? 3 : roll < 0.4 ? 2 : roll < 0.74 ? 0 : 1;
}

/**
 * A torus, stored as its two angles: `lat` is the position AROUND the ring and
 * `z` the position around the tube. Both are needed every frame — the ring
 * angle also carries the travelling wave — so they are kept as angles rather
 * than baked into coordinates that would have to be un-projected again.
 */
function createRibbonField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    // Slight bias toward the tube's outer face so the band has a lit edge.
    const tube = Math.random() * Math.PI * 2;
    motes.push({
      x: 0,
      y: 0,
      z: tube,
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.45 + Math.random() * 1.5,
      seed: Math.random() * Math.PI * 2,
      // Doubles as the tube thickness this mote sits at, 0..1.
      wobble: Math.pow(Math.random(), 0.7),
    });
  }
  return motes;
}

/**
 * Spokes out of a centre. `lat` is the spoke's angle and `z` how far along it
 * the mote sits; the square root biases points inward so the core stays dense
 * while the arms thin out.
 */
function createFlareField(count: number): Mote[] {
  const motes: Mote[] = [];
  const spokes = 34;
  for (let i = 0; i < count; i++) {
    const spoke = Math.floor(Math.random() * spokes);
    // Jitter around the spoke, widening with distance so arms fan out.
    const along = Math.sqrt(Math.random());
    motes.push({
      x: (Math.random() * 2 - 1) * 0.06,
      y: 0,
      z: along,
      lat: (spoke / spokes) * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.7,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.01 + Math.random() * 0.04,
    });
  }
  return motes;
}

/**
 * Hyperspace. Every mote owns a bearing and races outward from the vanishing
 * point, wrapping when it leaves. `lat` is the bearing, `z` the position along
 * its run, `x` a per-mote speed so the field never moves as one sheet.
 */
function createWarpField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0.55 + Math.random() * 0.9,
      y: 0,
      z: Math.random(),
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.6,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.004 + Math.random() * 0.02,
    });
  }
  return motes;
}

/**
 * A nucleus with filaments. Motes ride one of a handful of curling strands —
 * `y` names the strand, `z` the distance along it — so the cloud reads as
 * threads rather than as scatter.
 */
const PLEXUS_STRANDS = 26;
function createPlexusField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const strand = Math.floor(Math.random() * PLEXUS_STRANDS);
    motes.push({
      x: (Math.random() * 2 - 1) * 0.05,
      y: strand,
      z: Math.pow(Math.random(), 0.75),
      lat: (strand / PLEXUS_STRANDS) * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.35 + Math.random() * 1.3,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.02 + Math.random() * 0.06,
    });
  }
  return motes;
}

/**
 * A faceted globe. Vertices sit on a true sphere (no radial jitter) so the
 * edges drawn between neighbours form clean facets rather than a haze.
 */
function createLatticeField(count: number): Mote[] {
  const motes: Mote[] = [];
  // Fibonacci placement — an even spread, which is what makes the facets
  // regular. Random points would clump and the wireframe would look torn.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    motes.push({
      x: Math.cos(theta) * ring,
      y,
      z: Math.sin(theta) * ring,
      lat: y,
      color: pickTint(Math.random()),
      scale: 0.5 + Math.random() * 0.9,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.004 + Math.random() * 0.012,
    });
  }
  return motes;
}

/**
 * The aperture: motes packed into a narrow annulus so the blades drawn through
 * them read as one dense fan around a hollow eye.
 */
function createFanField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0,
      y: 0,
      z: Math.random(),
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.3 + Math.random() * 1.1,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.006 + Math.random() * 0.02,
    });
  }
  return motes;
}

/**
 * A detonation held mid-burst: motes fly outward on their own bearings at
 * their own speeds, but from a shared front, so the cloud keeps a leading edge
 * instead of dissolving evenly.
 */
function createNovaField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0.5 + Math.random() * 1.1,
      y: (Math.random() * 2 - 1) * 0.3,
      z: Math.random(),
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.9,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.01 + Math.random() * 0.05,
    });
  }
  return motes;
}

/**
 * A double helix. `y` names the strand (0 or 1, half a turn apart), `z` is the
 * position along the axis. Stored as a parameter rather than coordinates
 * because the strand has to keep twisting every frame.
 */
function createHelixField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: (Math.random() * 2 - 1) * 0.04,
      y: i % 2,
      z: Math.random(),
      lat: 0,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.4,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.006 + Math.random() * 0.024,
    });
  }
  return motes;
}

/**
 * A spiral galaxy. `y` names the arm, `z` the distance out along it. The
 * square-root bias packs the core and thins the rim, which is what makes a
 * spiral read as one rather than as a pinwheel of even dots.
 */
const VORTEX_ARMS = 4;
function createVortexField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const arm = Math.floor(Math.random() * VORTEX_ARMS);
    motes.push({
      // Scatter across the arm's width, widening outward.
      x: (Math.random() * 2 - 1) * 0.5,
      y: arm,
      z: Math.sqrt(Math.random()),
      lat: (arm / VORTEX_ARMS) * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.35 + Math.random() * 1.5,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.01 + Math.random() * 0.05,
    });
  }
  return motes;
}

/**
 * A tunnel rushing past. `z` is depth into the tunnel and `lat` the angle on
 * the wall; motes ride the wall toward the viewer and wrap. `x` is a per-mote
 * speed so the wall never moves as one rigid pipe.
 */
function createTunnelField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0.7 + Math.random() * 0.6,
      y: 0,
      z: Math.random(),
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.5,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.02 + Math.random() * 0.06,
    });
  }
  return motes;
}

/**
 * A flock. `y` names which of a handful of clusters a mote belongs to; the
 * clusters wander on their own paths and the motes hold a loose offset from
 * theirs. Cheap, and it reads as something alive rather than as a field.
 */
const SWARM_CLUSTERS = 7;
function createSwarmField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: (Math.random() * 2 - 1) * 0.34,
      y: Math.floor(Math.random() * SWARM_CLUSTERS),
      z: (Math.random() * 2 - 1) * 0.34,
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.5,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.04 + Math.random() * 0.1,
    });
  }
  return motes;
}

/**
 * Bodies on tilted orbits. `y` names the orbit, `lat` the angle along it. Each
 * orbit gets its own radius and tilt in the projection, so they cross rather
 * than nesting — the thing that makes an orrery read as three dimensional.
 */
const ORBIT_RINGS = 5;
function createOrbitField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0,
      y: i % ORBIT_RINGS,
      // A little spread across the track so it reads as a band, not a wire.
      z: (Math.random() * 2 - 1) * 0.035,
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.4 + Math.random() * 1.6,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.006 + Math.random() * 0.02,
    });
  }
  return motes;
}

/**
 * An iris. `y` names the concentric band and `lat` the angle within it; the
 * bands counter-rotate and the whole aperture dilates, so it reads as an eye
 * rather than as a set of rings.
 */
const IRIS_BANDS = 6;
function createIrisField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({
      x: 0,
      y: i % IRIS_BANDS,
      z: Math.random(),
      lat: Math.random() * Math.PI * 2,
      color: pickTint(Math.random()),
      scale: 0.35 + Math.random() * 1.2,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.004 + Math.random() * 0.016,
    });
  }
  return motes;
}

export function createFormField(form: OrbForm, count: number): Mote[] {
  if (form === "ribbon") return createRibbonField(count);
  if (form === "flare") return createFlareField(count);
  if (form === "warp") return createWarpField(count);
  if (form === "plexus") return createPlexusField(count);
  if (form === "lattice") return createLatticeField(count);
  if (form === "fan") return createFanField(count);
  if (form === "nova") return createNovaField(count);
  if (form === "helix") return createHelixField(count);
  if (form === "vortex") return createVortexField(count);
  if (form === "tunnel") return createTunnelField(count);
  if (form === "swarm") return createSwarmField(count);
  if (form === "orbit") return createOrbitField(count);
  if (form === "iris") return createIrisField(count);
  // The sphere's shell is `orb-motes`' own — the original field, unchanged.
  return createMoteField(count);
}

/** The sphere: rotate about the screen's vertical axis, exactly as it always
 *  has — `lat` adds a differential twist that reads as plasma banding. */
function projectSphere(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice } = mood;
  const swirl = spin + mote.lat * 1.15;
  const sin = Math.sin(swirl);
  const cos = Math.cos(swirl);
  const tremor = 1 + voice * 0.1 * Math.sin(now * 0.05 + mote.seed * 7);
  const driftX =
    (mote.x + Math.sin(now * 0.0007 + mote.seed) * mote.wobble) * tremor;
  const driftY =
    (mote.y + Math.cos(now * 0.0006 + mote.seed) * mote.wobble) * tremor;
  return {
    x: (driftX * cos - mote.z * sin) * breath,
    y: driftY * breath,
    depth: (driftX * sin + mote.z * cos + 1) / 2,
  };
}

/**
 * The ribbon: the ring's radius carries two travelling waves of different
 * frequency, so the band folds and unfolds without ever repeating on a beat
 * you can count. The tube stays face-on — no axis spin — so the hollow middle
 * survives, which is the whole reason to pick this form.
 */
function projectRibbon(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, listening } = mood;
  // Flow AROUND the ring rather than rotating the ring itself.
  const u = mote.lat + spin * 0.6;
  const wave =
    Math.sin(u * 3 + now * 0.0011) * 0.1 +
    Math.sin(u * 5 - now * 0.0014 + mote.seed * 0.2) * 0.055 +
    Math.sin(u * 2 + now * 0.0006) * 0.04;
  const swell = 1 + voice * 0.14 + listening * 0.05;
  const ringRadius = (0.86 + wave * (1 + voice * 0.6)) * swell * breath;
  // Tube: thin, and thicker where the wave crests so the fold reads.
  const tubeAngle = mote.z + now * 0.0004 + mote.seed;
  const tube = (0.055 + mote.wobble * 0.1) * (1 + voice * 0.5);
  const offset = Math.cos(tubeAngle) * tube;
  const radius = ringRadius + offset;
  return {
    x: Math.cos(u) * radius,
    y: Math.sin(u) * radius,
    // The tube's near face is bright, its far face dim — that shading is what
    // makes a flat circle of dots read as a band with volume.
    depth: (Math.sin(tubeAngle) + 1) / 2,
  };
}

/**
 * The flare: motes stream outward along spokes that twist with the spin, so
 * the arms curve. Near the centre they are packed and hot; by the rim they are
 * sparse and faint.
 */
function projectFlare(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, energy } = mood;
  // Travel outward over time, wrapping — the arms are always streaming.
  const travel = (mote.z + now * 0.00006 * (0.6 + energy + voice)) % 1;
  const along = travel * travel * 0.92 + 0.12;
  // Twist grows with distance, which is what bends a straight spoke into an arm.
  const angle = mote.lat + spin * 0.9 + along * (1.1 + voice * 0.5) + mote.x;
  const jitter = Math.sin(now * 0.0009 + mote.seed) * mote.wobble * along;
  const radius = (along + jitter) * breath * (1 + voice * 0.12);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    // Bright at the core, fading outward.
    depth: Math.max(0, 1 - along * 0.85),
  };
}

/** Warp: race outward on a fixed bearing, wrapping at the rim. The eased
 *  `t*t` makes motes accelerate as they go, which is what sells depth. */
function projectWarp(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, breath, voice, energy } = mood;
  const speed = mote.x * (0.00013 + energy * 0.00016 + voice * 0.0004);
  const t = (mote.z + now * speed) % 1;
  const radius = t * t * 1.45 * breath;
  const angle = mote.lat + Math.sin(now * 0.0003 + mote.seed) * mote.wobble;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    // Brightest mid-flight, gone at the rim — a streak fading as it leaves.
    depth: Math.max(0, Math.min(1, t * 2.4 * (1 - t * 0.85))),
  };
}

/** Plexus: strands curl away from the nucleus, each on its own slow sway. */
function projectPlexus(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, listening } = mood;
  const along = mote.z;
  const strandPhase = mote.y * 1.7;
  // The curl grows along the strand, so the near end is straight and the far
  // end whips — a tendril rather than a spoke.
  const sway =
    Math.sin(now * 0.0005 + strandPhase) * 0.55 * along * along +
    Math.sin(now * 0.0009 + mote.seed) * mote.wobble * along;
  const angle = mote.lat + spin * 0.35 + sway + mote.x;
  const radius =
    (0.12 + along * 1.02) * breath * (1 + voice * 0.16 + listening * 0.05);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    depth: Math.max(0, 1 - along * 0.6),
  };
}

/** Lattice: a real 3D rotation about two axes, so facets turn toward and away
 *  from the viewer and the globe reads as solid. */
function projectLattice(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { spin, breath, voice, now } = mood;
  const yaw = spin * 0.8;
  const pitch = 0.35 + Math.sin(now * 0.0002) * 0.22;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x1 = mote.x * cosY - mote.z * sinY;
  const z1 = mote.x * sinY + mote.z * cosY;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const y2 = mote.y * cosP - z1 * sinP;
  const z2 = mote.y * sinP + z1 * cosP;
  const swell = breath * (0.94 + voice * 0.12);
  return {
    x: x1 * swell,
    y: y2 * swell,
    depth: (z2 + 1) / 2,
  };
}

/** Aperture: a tight annulus. `z` places the mote across the blade band, so
 *  the ring has a soft inner and outer edge without any motes in the eye. */
function projectFan(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, listening } = mood;
  const angle = mote.lat + spin * 0.5;
  const band = 0.62 + mote.z * 0.42;
  const pulse = 1 + Math.sin(now * 0.0012 + angle * 4) * 0.03;
  const radius =
    band * pulse * breath * (1 + voice * 0.1 + listening * 0.04) + mote.wobble;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    depth: 0.35 + (1 - Math.abs(mote.z - 0.5) * 2) * 0.6,
  };
}

/** Nova: a shared expanding front with per-mote speed, so the burst keeps a
 *  leading edge instead of dissolving into an even cloud. */
function projectNova(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, breath, voice, energy } = mood;
  const speed = mote.x * (0.00011 + energy * 0.00012 + voice * 0.00045);
  const t = (mote.z + now * speed) % 1;
  const eased = Math.pow(t, 0.62);
  const angle = mote.lat + mote.y * eased * 0.6;
  const radius = eased * 1.35 * breath;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    depth: Math.max(0, 1 - eased * 0.9),
  };
}

/** Helix: two strands twisting about a vertical axis, drifting upward. */
function projectHelix(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, listening } = mood;
  // Travel along the axis, wrapping — the ladder is always climbing.
  const along = (mote.z + now * 0.00007 * (1 + voice)) % 1;
  const turns = 3.2;
  const angle = along * Math.PI * 2 * turns + spin * 1.2 + mote.y * Math.PI;
  const width = (0.46 + voice * 0.08 + listening * 0.03) * breath;
  return {
    x: Math.cos(angle) * width + mote.x,
    // Vertical extent is the axis; centred, so it fills the frame top to
    // bottom rather than sitting in a band.
    y: (along - 0.5) * 1.85 * breath,
    // The strand nearest the viewer is the bright one — that alternation is
    // what makes a flat sine pair read as a twisting ribbon.
    depth: (Math.sin(angle) + 1) / 2,
  };
}

/** Vortex: a flattened spiral, arms trailing as they wind outward. */
function projectVortex(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, energy } = mood;
  const out = mote.z;
  // Differential rotation — the inside turns faster than the rim, which is
  // what winds a spiral rather than turning a rigid pinwheel.
  const lead = spin * (1.6 - out * 0.9);
  const angle =
    mote.lat +
    lead +
    out * 3.4 +
    mote.x * (0.1 + out * 0.35) +
    mote.seed * 0.04;
  const radius = out * 1.15 * breath * (1 + voice * 0.1);
  const wobble = Math.sin(now * 0.0007 + mote.seed) * mote.wobble * out;
  return {
    x: Math.cos(angle) * (radius + wobble),
    // Squashed vertically: a disc seen at a shallow angle.
    y: Math.sin(angle) * (radius + wobble) * 0.42,
    depth: Math.max(0, 1 - out * 0.78) * (0.7 + energy * 0.3),
  };
}

/** Tunnel: the wall rushes past and wraps at the vanishing point. */
function projectTunnel(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, energy } = mood;
  const speed = mote.x * (0.00016 + energy * 0.0002 + voice * 0.0005);
  const t = (mote.z + now * speed) % 1;
  // Perspective: an even step in depth is an accelerating step on screen.
  const radius = (0.06 + t * t * 1.5) * breath;
  const angle =
    mote.lat + spin * 0.4 + Math.sin(now * 0.0005 + mote.seed) * mote.wobble;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    depth: Math.max(0, Math.min(1, t * 2.2 * (1 - t * 0.8))),
  };
}

/** Swarm: clusters wander, motes hold a loose station on theirs. */
function projectSwarm(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, breath, voice, listening } = mood;
  // Each cluster on its own lissajous — irrational-ish ratios so the flock
  // never returns to a formation you have already seen.
  const c = mote.y;
  const cx = Math.sin(now * 0.00042 + c * 1.7) * 0.52;
  const cy = Math.cos(now * 0.00037 + c * 2.3) * 0.46;
  // The mote breathes around its cluster rather than sitting rigid on it.
  const drift = 1 + Math.sin(now * 0.0011 + mote.seed) * mote.wobble * 3;
  const spread = (1 + voice * 0.35 + listening * 0.1) * breath;
  return {
    x: (cx + mote.x * drift) * spread,
    y: (cy + mote.z * drift) * spread,
    depth: 0.45 + Math.sin(now * 0.0008 + mote.seed * 2) * 0.35,
  };
}

/** Orbit: bodies on tilted ellipses that cross rather than nest. */
function projectOrbit(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { spin, breath, voice, now } = mood;
  const ring = mote.y;
  const radius = (0.42 + ring * 0.15) * breath * (1 + voice * 0.08);
  // Inner orbits run faster — Kepler by feel, and it keeps the tracks from
  // ever locking into one turning wheel.
  const angle = mote.lat + spin * (1.5 - ring * 0.2);
  const tilt = 0.35 + ring * 0.26;
  const squash = Math.cos(tilt);
  // Each track is also rolled, so they cross instead of stacking.
  const roll = ring * 0.7 + now * 0.00004;
  const ex = Math.cos(angle) * (radius + mote.z);
  const ey = Math.sin(angle) * (radius + mote.z) * squash;
  return {
    x: ex * Math.cos(roll) - ey * Math.sin(roll),
    y: ex * Math.sin(roll) + ey * Math.cos(roll),
    depth: (Math.sin(angle) + 1) / 2,
  };
}

/** Iris: counter-rotating bands around a pupil that dilates. */
function projectIris(mote: Mote, mood: ProjectionMood): ProjectedMote {
  const { now, spin, breath, voice, listening } = mood;
  const band = mote.y;
  // The pupil opens with the voice — the room's one literal reaction.
  const dilate =
    1 + voice * 0.26 + listening * 0.08 + Math.sin(now * 0.0009) * 0.05;
  const radius = (0.3 + band * 0.13) * dilate * breath;
  // Alternate bands turn opposite ways.
  const direction = band % 2 === 0 ? 1 : -1;
  const angle = mote.lat + spin * direction * (0.8 + band * 0.12);
  return {
    x: Math.cos(angle) * (radius + mote.wobble),
    y: Math.sin(angle) * (radius + mote.wobble),
    depth: 0.4 + (1 - band / 6) * 0.55,
  };
}

export function projectMote(
  form: OrbForm,
  mote: Mote,
  mood: ProjectionMood,
): ProjectedMote {
  if (form === "ribbon") return projectRibbon(mote, mood);
  if (form === "flare") return projectFlare(mote, mood);
  if (form === "warp") return projectWarp(mote, mood);
  if (form === "plexus") return projectPlexus(mote, mood);
  if (form === "lattice") return projectLattice(mote, mood);
  if (form === "fan") return projectFan(mote, mood);
  if (form === "nova") return projectNova(mote, mood);
  if (form === "helix") return projectHelix(mote, mood);
  if (form === "vortex") return projectVortex(mote, mood);
  if (form === "tunnel") return projectTunnel(mote, mood);
  if (form === "swarm") return projectSwarm(mote, mood);
  if (form === "orbit") return projectOrbit(mote, mood);
  if (form === "iris") return projectIris(mote, mood);
  return projectSphere(mote, mood);
}
