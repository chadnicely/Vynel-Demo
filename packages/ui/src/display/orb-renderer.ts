import { require2dContext } from "./canvas-context.js";
import { createMoteField, createMoteSprites } from "./orb-motes.js";
import type { Mote } from "./orb-motes.js";
import { DEFAULT_ORB_PALETTE } from "./orb-palette.js";
import type { OrbPalette } from "./orb-palette.js";
import { ringGeometry, strokeSegmentedRing } from "./orb-rings.js";

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
}

const DEFAULT_MOTE_COUNT = 1700;
const DEFAULT_SPIKE_STRENGTH = 1;
/** The demo only ever spiked at 0.9-1.0; harder just smears the shockwave. */
const MAX_SPIKE_STRENGTH = 1;
/** Retina is worth the pixels; 3x+ displays are not — it quadruples fill cost. */
const MAX_DEVICE_PIXEL_RATIO = 2;
/** Past a handful the rings stack into a white smear and cost real time. */
const MAX_WAVES = 6;
/** Ceiling on the eased envelope, which stacks a spike onto the speech flicker. */
const MAX_TALK = 1.6;

interface Shockwave {
  radius: number;
  alpha: number;
  punch: number;
}

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
  let sprites = createMoteSprites(palette);
  let motes: Mote[] = createMoteField(options.moteCount ?? DEFAULT_MOTE_COUNT);

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
      radius * 2.1,
    );
    bloom.addColorStop(0, `rgba(${core},${Math.min(0.95, heat)})`);
    bloom.addColorStop(0.32, `rgba(${palette.bloom.mid},${heat * 0.5})`);
    bloom.addColorStop(0.7, `rgba(${palette.bloom.outer},${heat * 0.18})`);
    bloom.addColorStop(1, `rgba(${palette.bloom.edge},0)`);
    context.fillStyle = bloom;
    context.beginPath();
    context.arc(centerX, centerY, radius * 2.1, 0, Math.PI * 2);
    context.fill();
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
    const breath =
      1 +
      Math.sin(now / 1500) * 0.03 +
      speaking * 0.05 +
      listening * 0.04 +
      voice * 0.16;
    for (const mote of motes) {
      const swirl = spin + mote.lat * 1.15;
      const sin = Math.sin(swirl);
      const cos = Math.cos(swirl);
      const tremor = 1 + voice * 0.1 * Math.sin(now * 0.05 + mote.seed * 7);
      const driftX =
        (mote.x + Math.sin(now * 0.0007 + mote.seed) * mote.wobble) * tremor;
      const driftY =
        (mote.y + Math.cos(now * 0.0006 + mote.seed) * mote.wobble) * tremor;
      const x = (driftX * cos - mote.z * sin) * breath;
      const depth = (driftX * sin + mote.z * cos + 1) / 2;
      const twinkle = 0.65 + 0.35 * Math.sin(now / 560 + mote.seed);
      const size =
        mote.scale *
        scale *
        (6 + depth * 12) *
        (0.85 + energy * 0.3 + voice * 0.9);
      context.globalAlpha = Math.min(
        1,
        (0.14 + depth * 0.5) * twinkle * (0.9 + listening * 0.45 + voice * 0.5),
      );
      context.drawImage(
        sprites[mote.color]!,
        centerX + x * radius - size / 2,
        centerY + driftY * breath * radius - size / 2,
        size,
        size,
      );
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
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
    spin += 0.0026 + energy * 0.004 + listening * 0.005 + voice * 0.006;

    context.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height * 0.47;
    const radius = Math.min(width, height) * 0.3;
    const heat = 0.55 + energy * 0.35 + listening * 0.35 + voice * 0.5;

    drawBloom(centerX, centerY, radius, heat, voice);
    drawWaves(centerX, centerY, radius);
    drawMotes(now, centerX, centerY, radius, voice);
    drawRings(centerX, centerY, radius, voice);

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
