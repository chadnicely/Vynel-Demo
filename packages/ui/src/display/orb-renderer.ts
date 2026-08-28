import { require2dContext } from "./canvas-context.js";
import { createMoteSprites } from "./orb-motes.js";
import type { Mote } from "./orb-motes.js";
import { DEFAULT_ORB_PALETTE } from "./orb-palette.js";
import type { OrbPalette } from "./orb-palette.js";
import { ringGeometry, strokeSegmentedRing } from "./orb-rings.js";
import {
  createFormField,
  FORM_BLOOM,
  FORM_DECORATION,
  FORM_MOTE_COUNT,
  FORM_STREAKS,
  projectMote,
} from "./orb-forms.js";
import type { OrbForm } from "./orb-forms.js";

export interface OrbRenderer {
  /** How busy the assistant is, 0..1 — drives spin and glow. Eased, not cut. */
  setEnergy(value: number): void;
  /** Swells and brightens while the microphone is open. */
  setListening(on: boolean): void;
  /** The demo's `pulse`: an on/off glow for as long as it is talking. */
  setSpeaking(on: boolean): void;
  /** A spoken clause just landed: punch the envelope and throw a shockwave. */
  spike(strength?: number): void;
  /** Cancels the frame loop, stops observing, releases the sprites. Idempotent. */
  stop(): void;
}

export interface OrbRendererOptions {
  palette?: OrbPalette;
  moteCount?: number;
  /** Which shape the cloud takes. Defaults to the original sphere. */
  form?: OrbForm;
}

const DEFAULT_SPIKE_STRENGTH = 1;
/** The demo only ever spiked at 0.9-1.0; harder just smears the shockwave. */
const MAX_SPIKE_STRENGTH = 1;
/** Retina is worth the pixels; 3x+ displays are not — it quadruples fill cost. */
const MAX_DEVICE_PIXEL_RATIO = 2;
/** Past a handful the rings stack into a white smear and cost real time. */
const MAX_WAVES = 6;
/** Ceiling on the eased envelope, which stacks a spike onto the speech flicker. */
const MAX_TALK = 1.6;
/**
 * How far the object throws light, in orb radii.
 *
 * Left WIDE on purpose. It was briefly cut to 1.15 to solve the black-and-white
 * palette washing out, which dimmed all nine — the wrong trade: eight of them
 * were right. White is the only hue that fogs at this reach, because it is the
 * only one whose glow is not a different colour from the object, so the fix
 * belongs in that palette (see ICE in display-colours.ts) and not here.
 */
const BLOOM_REACH = 2.3;
/** Inside this radius (in orb radii) motes fade toward `CENTRE_GUARD_FLOOR`,
 *  so additive light stops summing past white at the point every centre-lit
 *  form converges on. Tuned to just cover the core, not the body. */
/* SIGNED OFF ON CAMERA (Kafi, 2026-08-27) — do not lower.
 *
 * The mote alpha, the size curve, this guard, BLOOM_REACH, and the nine bloom
 * palettes were all cut together in one pass to solve the black-and-white
 * palette washing out. It made the whole set too dark to see. The correct fix
 * for a white glow is in that ONE palette, not in the shared brightness: white
 * is the only hue whose glow cannot be told apart from the object it surrounds.
 * If a future pass needs to solve "too much glow", change the offending
 * palette's bloom colours — never these. */
const CENTRE_GUARD_RADIUS = 0.32;
const CENTRE_GUARD_FLOOR = 0.22;
/* The ceilings on the bloom's centre stop sit ABOVE the range `heat` can
 * actually reach, deliberately. A cap the raised idle floor already brushed
 * would pin the glow at maximum, and the orb would stop visibly brightening
 * when it got busy — which is the one thing this glow exists to show. */

interface Shockwave {
  radius: number;
  alpha: number;
  punch: number;
}

/**
 * How much of the smaller screen dimension each form takes, as a radius.
 * Tuned per form rather than shared: the sphere carries dials out at 1.6× its
 * own radius and would clip if it filled as much as the ribbon, while the
 * streaming forms are SUPPOSED to run off the edge.
 */
const FORM_RADIUS: Record<OrbForm, number> = {
  sphere: 0.34,
  ribbon: 0.42,
  flare: 0.4,
  warp: 0.46,
  plexus: 0.4,
  lattice: 0.42,
  fan: 0.44,
  nova: 0.44,
  helix: 0.4,
  vortex: 0.44,
  tunnel: 0.46,
  swarm: 0.42,
  orbit: 0.36,
  iris: 0.42,
};

/**
 * The Display orb: a glowing shell of motes drawn additively, ringed by three
 * segmented dials. Ported from the mission-control demo's `makeCore`.
 *
 * Every number it reacts to is set from outside — it never invents motion.
 */
export function createOrbRenderer(
  canvas: HTMLCanvasElement,
  options: OrbRendererOptions = {},
): OrbRenderer {
  const context = require2dContext(canvas);

  const palette = options.palette ?? DEFAULT_ORB_PALETTE;
  const form: OrbForm = options.form ?? "sphere";
  let sprites = createMoteSprites(palette);
  let motes: Mote[] = createFormField(
    form,
    options.moteCount ?? FORM_MOTE_COUNT[form],
  );

  let width = 1;
  let height = 1;
  let scale = 1;

  let spin = 0;
  let energy = 0;
  let energyTarget = 0;
  let listening = 0;
  let listenTarget = 0;
  let speaking = 0;
  let speakTarget = 0;
  /** The live voice envelope, 0..MAX_TALK — decays between clauses. */
  let talk = 0;
  const waves: Shockwave[] = [];
  let animationFrame = 0;
  let stopped = false;

  function deviceScale(): number {
    return Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  }

  // The demo read `clientWidth` inside the frame loop, forcing a layout every
  // tick; the observer gives us the same number for free when it changes.
  function measure(): void {
    scale = deviceScale();
    const nextWidth = Math.max(1, Math.round(canvas.clientWidth * scale));
    const nextHeight = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    width = nextWidth;
    height = nextHeight;
  }

  const observer = new ResizeObserver(measure);
  observer.observe(canvas);
  measure();

  /**
   * The glow behind the cloud. Each form needs a different one: the sphere and
   * the flare are lit FROM the centre, but the ribbon's whole point is a hollow
   * middle — a centre-weighted bloom fills the hole back in and the form stops
   * reading as a ring. So the ribbon's light sits out on the band itself.
   */
  function drawBloom(
    centerX: number,
    centerY: number,
    radius: number,
    heat: number,
    voice: number,
  ): void {
    const core = voice > 0.4 ? palette.bloom.hot : palette.bloom.core;
    const bloom = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      radius * BLOOM_REACH,
    );
    if (FORM_BLOOM[form] === "hollow") {
      // Dark at the very centre, brightest at the band's radius (~0.86), out
      // to nothing — a glowing annulus rather than a ball of light.
      bloom.addColorStop(0, `rgba(${palette.bloom.edge},0)`);
      bloom.addColorStop(0.24, `rgba(${palette.bloom.outer},0)`);
      bloom.addColorStop(0.44, `rgba(${core},${Math.min(0.44, heat * 0.17)})`);
      bloom.addColorStop(0.6, `rgba(${palette.bloom.mid},${heat * 0.05})`);
      bloom.addColorStop(1, `rgba(${palette.bloom.edge},0)`);
    } else if (FORM_BLOOM[form] === "core") {
      // Hotter and tighter: the centre is the event, the rim falls away fast.
      bloom.addColorStop(0, `rgba(${core},${Math.min(0.62, heat * 0.24)})`);
      bloom.addColorStop(0.16, `rgba(${palette.bloom.hot},${heat * 0.2})`);
      bloom.addColorStop(0.42, `rgba(${palette.bloom.mid},${heat * 0.07})`);
      bloom.addColorStop(0.72, `rgba(${palette.bloom.outer},${heat * 0.02})`);
      bloom.addColorStop(1, `rgba(${palette.bloom.edge},0)`);
    } else {
      bloom.addColorStop(0, `rgba(${core},${Math.min(0.72, heat * 0.28)})`);
      bloom.addColorStop(0.32, `rgba(${palette.bloom.mid},${heat * 0.1})`);
      bloom.addColorStop(0.7, `rgba(${palette.bloom.outer},${heat * 0.03})`);
      bloom.addColorStop(1, `rgba(${palette.bloom.edge},0)`);
    }
    context.fillStyle = bloom;
    context.beginPath();
    context.arc(centerX, centerY, radius * BLOOM_REACH, 0, Math.PI * 2);
    context.fill();
  }

  /**
   * The flare's hard radial lines — the thing that separates it from a cloud.
   * Drawn additively over the motes, each one a taper from just outside the
   * core to a random reach, on the same twist as the arms so lines and motes
   * agree about which way the thing is turning.
   */
  const SPOKES = 26;
  function drawSpokes(
    centerX: number,
    centerY: number,
    radius: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (let i = 0; i < SPOKES; i++) {
      const base = (i / SPOKES) * Math.PI * 2;
      const angle = base + spin * 0.9;
      // Deterministic per-spoke variation — no per-frame randomness, or the
      // lines would strobe instead of streaming.
      const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5;
      const reach = (0.62 + jitter * 0.72) * (1 + voice * 0.2);
      const inner = radius * (0.16 + jitter * 0.1);
      const outer = radius * reach;
      const alpha = (0.26 + jitter * 0.28) * (0.8 + energy * 0.4 + voice * 0.7);
      const gradient = context.createLinearGradient(
        centerX + Math.cos(angle) * inner,
        centerY + Math.sin(angle) * inner,
        centerX + Math.cos(angle) * outer,
        centerY + Math.sin(angle) * outer,
      );
      gradient.addColorStop(0, `rgba(${palette.bloom.hot},${alpha})`);
      gradient.addColorStop(0.35, `rgba(${palette.rings[0]},${alpha * 0.7})`);
      gradient.addColorStop(1, `rgba(${palette.rings[0]},0)`);
      context.strokeStyle = gradient;
      context.lineWidth = (1.2 + jitter * 2.1) * scale;
      context.beginPath();
      context.moveTo(
        centerX + Math.cos(angle) * inner,
        centerY + Math.sin(angle) * inner,
      );
      context.lineTo(
        centerX + Math.cos(angle) * outer,
        centerY + Math.sin(angle) * outer,
      );
      context.stroke();
    }
    context.restore();
  }

  function drawWaves(centerX: number, centerY: number, radius: number): void {
    context.lineCap = "butt";
    for (let i = waves.length - 1; i >= 0; i--) {
      const wave = waves[i]!;
      wave.radius += 0.03 + 0.02 * wave.punch;
      wave.alpha *= 0.94;
      if (wave.alpha < 0.02) {
        waves.splice(i, 1);
        continue;
      }
      context.lineWidth = 2.5 * wave.punch * scale;
      context.strokeStyle = `rgba(${palette.wave},${wave.alpha})`;
      context.beginPath();
      context.ellipse(
        centerX,
        centerY,
        radius * wave.radius,
        radius * wave.radius * 0.95,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }

  /** Light added onto light, so overlapping motes blow out to white. */
  function drawMotes(
    now: number,
    centerX: number,
    centerY: number,
    radius: number,
    voice: number,
  ): void {
    context.globalCompositeOperation = "lighter";
    // A breath you can actually see: 3% was imperceptible on camera. Two
    // frequencies rather than one, so the swell never lands on a countable
    // beat the way a single sine does.
    const breath =
      1 +
      Math.sin(now / 620) * 0.075 +
      Math.sin(now / 1130) * 0.045 +
      speaking * 0.08 +
      listening * 0.06 +
      voice * 0.22;
    const mood = { now, spin, breath, voice, energy, listening };
    const streaked = FORM_STREAKS.has(form);
    for (const mote of motes) {
      const point = projectMote(form, mote, mood);
      const twinkle = 0.65 + 0.35 * Math.sin(now / 560 + mote.seed);
      // CENTRE GUARD. Everything is drawn with `lighter`, so wherever the
      // geometry converges the light sums past white and clips — the middle
      // burns out to a flat disc and the colour goes with it. The forms lit
      // from a point are the worst: their fields are biased inward on purpose.
      // Fading motes as they approach dead centre keeps the core hot without
      // letting it saturate, which is what preserves the hue there.
      const distance = Math.hypot(point.x, point.y);
      const crowding = Math.min(1, distance / CENTRE_GUARD_RADIUS);
      const alpha = Math.min(
        1,
        (0.3 + point.depth * 0.78) *
          twinkle *
          (1.15 + listening * 0.45 + voice * 0.5) *
          (CENTRE_GUARD_FLOOR + crowding * (1 - CENTRE_GUARD_FLOOR)),
      );
      if (streaked) {
        // A streak, not a dot: drawn along the mote's own bearing and length-
        // scaled by how far out it is, which is what turns a field of points
        // into hyperspace. Sprites cannot do this — they are round.
        const distance = Math.hypot(point.x, point.y);
        const angle = Math.atan2(point.y, point.x);
        const tail = distance * (0.16 + mote.scale * 0.09 + voice * 0.1);
        const x = centerX + point.x * radius;
        const y = centerY + point.y * radius;
        const tx = centerX + Math.cos(angle) * (distance - tail) * radius;
        const ty = centerY + Math.sin(angle) * (distance - tail) * radius;
        context.strokeStyle = `rgba(${palette.motes[mote.color]},${alpha})`;
        context.lineWidth = mote.scale * scale * 1.5;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(tx, ty);
        context.lineTo(x, y);
        context.stroke();
        continue;
      }
      const size =
        mote.scale *
        scale *
        (6 + point.depth * 12) *
        (0.85 + energy * 0.3 + voice * 0.9);
      context.globalAlpha = alpha;
      context.drawImage(
        sprites[mote.color]!,
        centerX + point.x * radius - size / 2,
        centerY + point.y * radius - size / 2,
        size,
        size,
      );
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  /**
   * The plexus' tendrils. Each strand is one curve through the same sway the
   * motes ride, so the line and the dots on it agree — draw them from
   * different maths and the beads visibly drift off their thread.
   */
  function drawFilaments(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    const strands = 26;
    for (let i = 0; i < strands; i++) {
      const base = (i / strands) * Math.PI * 2;
      const alpha = (0.3 + (i % 3) * 0.08) * (0.9 + energy * 0.4 + voice * 0.8);
      context.strokeStyle = `rgba(${palette.rings[i % 3]},${alpha})`;
      context.lineWidth = (1.1 + (i % 2) * 0.9) * scale;
      context.beginPath();
      for (let step = 0; step <= 22; step++) {
        const along = step / 22;
        const sway = Math.sin(now * 0.0005 + i * 1.7) * 0.55 * along * along;
        const angle = base + spin * 0.35 + sway;
        const r = (0.12 + along * 1.02) * radius * (1 + voice * 0.16);
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
  }

  /**
   * The lattice's facets. Edges are drawn between vertices that are already
   * NEAR each other on screen, which is cheap and gives the irregular triangle
   * mesh the reference has — a fixed edge list would need the field's
   * neighbours precomputed and would break the moment the count changed.
   */
  function drawEdges(
    centerX: number,
    centerY: number,
    radius: number,
    voice: number,
  ): void {
    const mood = { now: 0, spin, breath: 1, voice, energy, listening };
    const points = motes.map((mote) => projectMote("lattice", mote, mood));
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineWidth = 1.15 * scale;
    // Squared threshold, so the inner loop never calls sqrt.
    const limit = 0.062;
    context.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      // Only look ahead a short window: every pair would be O(n²) across 1400
      // vertices, and the mesh reads the same from a local sample.
      for (let j = i + 1; j < Math.min(points.length, i + 14); j += 1) {
        const b = points[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > limit) continue;
        context.moveTo(centerX + a.x * radius, centerY + a.y * radius);
        context.lineTo(centerX + b.x * radius, centerY + b.y * radius);
      }
    }
    context.strokeStyle = `rgba(${palette.rings[0]},${
      0.42 + energy * 0.2 + voice * 0.4
    })`;
    context.stroke();
    context.restore();
  }

  /** The aperture's blades: many fine radial strokes across a narrow band. */
  const BLADES = 132;
  function drawBlades(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineWidth = 1.5 * scale;
    context.strokeStyle = `rgba(${palette.rings[0]},${
      0.5 + energy * 0.25 + voice * 0.5
    })`;
    context.beginPath();
    for (let i = 0; i < BLADES; i++) {
      const angle = (i / BLADES) * Math.PI * 2 + spin * 0.5;
      // Each blade breathes on its own phase, so the ring shimmers rather than
      // pulsing as one solid disc.
      const wobble = Math.sin(now * 0.0012 + angle * 4) * 0.03;
      const inner = radius * (0.62 + wobble);
      const outer = radius * (1.04 + wobble + voice * 0.1);
      context.moveTo(
        centerX + Math.cos(angle) * inner,
        centerY + Math.sin(angle) * inner,
      );
      context.lineTo(
        centerX + Math.cos(angle) * outer,
        centerY + Math.sin(angle) * outer,
      );
    }
    context.stroke();
    context.restore();
  }

  /** The nova's shockwave rings — three, expanding on their own cycles. */
  function drawShock(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const cycle = (now * 0.00016 + i / 3) % 1;
      const r = radius * (0.2 + cycle * 1.5);
      const fade = (1 - cycle) * (0.6 + voice * 0.5);
      context.lineWidth = (1 + (1 - cycle) * 2.6) * scale;
      context.strokeStyle = `rgba(${palette.rings[i % 3]},${fade})`;
      context.beginPath();
      context.arc(centerX, centerY, r, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  /** The helix's ladder: a rung every few steps between the two strands. */
  function drawRungs(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.lineWidth = 1.4 * scale;
    const RUNGS = 34;
    for (let i = 0; i < RUNGS; i++) {
      const along = (i / RUNGS + now * 0.00007 * (1 + voice)) % 1;
      const angle = along * Math.PI * 2 * 3.2 + spin * 1.2;
      const width = (0.46 + voice * 0.08) * radius;
      const y = centerY + (along - 0.5) * 1.85 * radius;
      const ax = centerX + Math.cos(angle) * width;
      const bx = centerX + Math.cos(angle + Math.PI) * width;
      // Rungs seen edge-on are nearly invisible; fade them out as they turn
      // side-on so the ladder reads as rotating rather than as flickering.
      const face = Math.abs(Math.sin(angle));
      context.strokeStyle = `rgba(${palette.rings[i % 3]},${
        (0.1 + face * 0.4) * (0.7 + energy * 0.3 + voice * 0.6)
      })`;
      context.beginPath();
      context.moveTo(ax, y);
      context.lineTo(bx, y);
      context.stroke();
    }
    context.restore();
  }

  /** The tunnel's ribs: perspective rings receding to the vanishing point. */
  function drawTunnelRings(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    const RIBS = 9;
    for (let i = 0; i < RIBS; i++) {
      const t = (i / RIBS + now * 0.00016 * (1 + energy + voice)) % 1;
      const r = (0.06 + t * t * 1.5) * radius;
      // Near ribs are thick and bright, far ones vanish — the depth cue.
      const near = t * t;
      context.lineWidth = (0.4 + near * 3.2) * scale;
      context.strokeStyle = `rgba(${palette.rings[i % 3]},${
        (0.08 + near * 0.42) * (0.7 + voice * 0.6)
      })`;
      context.beginPath();
      context.arc(centerX, centerY, r, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  /** The orrery's tracks: the tilted ellipses the bodies actually ride. */
  function drawOrbits(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineWidth = 1 * scale;
    for (let ring = 0; ring < 5; ring++) {
      const r = (0.42 + ring * 0.15) * radius * (1 + voice * 0.08);
      const tilt = 0.35 + ring * 0.26;
      const roll = ring * 0.7 + now * 0.00004;
      context.strokeStyle = `rgba(${palette.rings[ring % 3]},${
        0.22 + energy * 0.14 + voice * 0.3
      })`;
      context.beginPath();
      // Drawn with the SAME tilt and roll the bodies are projected with, so
      // they sit on their track instead of beside it.
      context.ellipse(
        centerX,
        centerY,
        r,
        r * Math.cos(tilt),
        roll,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.restore();
  }

  /** The iris: concentric arc segments, alternate bands turning opposite ways. */
  function drawArcs(
    centerX: number,
    centerY: number,
    radius: number,
    now: number,
    voice: number,
    listening: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "butt";
    const dilate =
      1 + voice * 0.26 + listening * 0.08 + Math.sin(now * 0.0009) * 0.05;
    for (let band = 0; band < 6; band++) {
      const r = (0.3 + band * 0.13) * dilate * radius;
      const direction = band % 2 === 0 ? 1 : -1;
      const rotation = spin * direction * (0.8 + band * 0.12);
      const segments = 8 + band * 4;
      const step = (Math.PI * 2) / segments;
      context.lineWidth = (1.4 + (band % 2) * 1.2) * scale;
      context.strokeStyle = `rgba(${palette.rings[band % 3]},${
        (0.26 + (band % 2) * 0.14) * (0.8 + energy * 0.3 + voice * 0.6)
      })`;
      context.beginPath();
      for (let i = 0; i < segments; i++) {
        const start = rotation + i * step;
        context.moveTo(
          centerX + r * Math.cos(start),
          centerY + r * Math.sin(start),
        );
        context.arc(centerX, centerY, r, start, start + step * 0.62);
      }
      context.stroke();
    }
    context.restore();
  }

  function drawRings(
    centerX: number,
    centerY: number,
    radius: number,
    voice: number,
  ): void {
    const mood = { radius, spin, listening, voice };
    for (const ring of ringGeometry(mood, palette)) {
      strokeSegmentedRing(context, centerX, centerY, ring, scale);
    }
  }

  function frame(now: number): void {
    if (stopped) return;
    // Dragging the window to a monitor of a different density changes the
    // pixel ratio without changing the BOX, so the observer never fires — the
    // orb would keep drawing at the old density until something else resized
    // it. Reading the ratio is a property read, not a layout.
    if (deviceScale() !== scale) measure();
    energy += (energyTarget - energy) * 0.04;
    listening += (listenTarget - listening) * 0.08;
    speaking += (speakTarget - speaking) * 0.2;
    talk *= 0.86;
    // Between clauses, while it is still speaking, keep the orb chattering so
    // it never freezes mid-sentence.
    if (speaking > 0.05) {
      const flicker = Math.abs(
        Math.sin(now * 0.017) * Math.sin(now * 0.011 + 0.6),
      );
      talk = Math.max(talk, speaking * (0.18 + 0.4 * flicker));
    }
    const voice = Math.min(MAX_TALK, talk);
    // IDLE FLOOR. Nothing is talking for most of a take, and at rest `energy`,
    // `listening` and `voice` are all zero — the cloud was turning on 0.0026
    // alone, which is nearly still. This keeps a real baseline of motion under
    // it and adds a slow swell so the room is never a frozen frame on camera,
    // then the live signals stack ON TOP as they always did.
    const idle = 0.55 + Math.sin(now * 0.0004) * 0.45;
    spin +=
      0.0075 +
      idle * 0.004 +
      energy * 0.007 +
      listening * 0.008 +
      voice * 0.012;

    context.clearRect(0, 0, width, height);
    const centerX = width / 2;
    // Dead centre, and BIG: this is filmed, and the presence is the subject.
    // The old 0.47/0.3 left the cloud small and high on the screen, sized for
    // a room that still had telemetry panels flanking it.
    const centerY = height * 0.5;
    const radius = Math.min(width, height) * FORM_RADIUS[form];
    // Hotter at rest too, and breathing — same reasoning as the spin floor.
    const heat =
      0.72 + idle * 0.18 + energy * 0.35 + listening * 0.35 + voice * 0.5;

    drawBloom(centerX, centerY, radius, heat, voice);
    drawWaves(centerX, centerY, radius);

    // Line work that belongs UNDER the motes, so the cloud sits on top of its
    // own structure rather than being crosshatched by it.
    const decoration = FORM_DECORATION[form];
    if (decoration === "spokes") drawSpokes(centerX, centerY, radius, voice);
    if (decoration === "filaments")
      drawFilaments(centerX, centerY, radius, now, voice);
    if (decoration === "blades")
      drawBlades(centerX, centerY, radius, now, voice);
    if (decoration === "edges") drawEdges(centerX, centerY, radius, voice);
    if (decoration === "rungs") drawRungs(centerX, centerY, radius, now, voice);
    if (decoration === "tunnel")
      drawTunnelRings(centerX, centerY, radius, now, voice);
    if (decoration === "orbits")
      drawOrbits(centerX, centerY, radius, now, voice);

    drawMotes(now, centerX, centerY, radius, voice);

    // …and the line work that belongs OVER it. The dials and the shockwaves
    // are meant to read as chrome in front of the cloud.
    if (decoration === "rings") drawRings(centerX, centerY, radius, voice);
    if (decoration === "shock") drawShock(centerX, centerY, radius, now, voice);
    if (decoration === "arcs")
      drawArcs(centerX, centerY, radius, now, voice, listening);

    animationFrame = requestAnimationFrame(frame);
  }

  animationFrame = requestAnimationFrame(frame);

  return {
    setEnergy(value) {
      if (stopped) return;
      energyTarget = Math.max(0, Math.min(1, value));
    },
    setListening(on) {
      if (stopped) return;
      listenTarget = on ? 1 : 0;
    },
    setSpeaking(on) {
      if (stopped) return;
      speakTarget = on ? 1 : 0;
    },
    spike(strength = DEFAULT_SPIKE_STRENGTH) {
      if (stopped) return;
      const punch = Math.max(0, Math.min(MAX_SPIKE_STRENGTH, strength));
      talk = Math.max(talk, punch);
      if (waves.length < MAX_WAVES) {
        waves.push({ radius: 1.2, alpha: 0.5 * punch, punch: 0.6 + punch });
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      sprites = [];
      motes = [];
      waves.length = 0;
    },
  };
}
