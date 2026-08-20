import { require2dContext } from "./canvas-context.js";
import type { OrbPalette } from "./orb-palette.js";

/** One point of the cloud. Coordinates are unit-sphere; the frame scales them. */
export interface Mote {
  x: number;
  y: number;
  z: number;
  /** Latitude, -1..1 — drives the differential twist that reads as plasma bands. */
  lat: number;
  /** Index into the sprite set. */
  color: number;
  /** Size multiplier. */
  scale: number;
  /** Per-mote phase, so twinkle and drift never march in step. */
  seed: number;
  /** Drift amplitude. */
  wobble: number;
}

/**
 * A hollow-ish shell rather than a solid ball: points sit between 55% and 100%
 * of the radius so the rim stays bright and the centre stays translucent.
 */
export function createMoteField(count: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const radius = 0.55 + Math.random() * 0.45;
    const roll = Math.random();
    motes.push({
      x: Math.sqrt(1 - u * u) * Math.cos(theta) * radius,
      y: Math.sqrt(1 - u * u) * Math.sin(theta) * radius,
      z: u * radius,
      lat: u,
      color: roll < 0.14 ? 3 : roll < 0.4 ? 2 : roll < 0.74 ? 0 : 1,
      scale: 0.5 + Math.random() * 1.8,
      seed: Math.random() * Math.PI * 2,
      wobble: 0.015 + Math.random() * 0.05,
    });
  }
  return motes;
}

const SPRITE_SIZE = 64;

/**
 * One blazing round mote per palette tint: a white-hot centre inside a
 * saturated halo. That inner spike is what turns a flat dot into plasma once
 * the frame draws it with `lighter` compositing.
 */
export function createMoteSprites(palette: OrbPalette): HTMLCanvasElement[] {
  return palette.motes.map((rgb) => {
    const sprite = document.createElement("canvas");
    sprite.width = SPRITE_SIZE;
    sprite.height = SPRITE_SIZE;
    const context = require2dContext(sprite);
    const half = SPRITE_SIZE / 2;
    const gradient = context.createRadialGradient(
      half,
      half,
      0,
      half,
      half,
      half,
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.98)");
    gradient.addColorStop(0.16, `rgba(${rgb},0.95)`);
    gradient.addColorStop(0.45, `rgba(${rgb},0.42)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return sprite;
  });
}
