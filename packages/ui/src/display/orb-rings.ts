import type { OrbPalette } from "./orb-palette.js";

/** One dial. Concentric with the orb, so it carries no centre of its own. */
export interface SegmentedRing {
  radius: number;
  /** Where segment 0 starts, in radians. */
  rotation: number;
  segments: number;
  /** Fraction of each segment's slot that is painted — the rest is the gap. */
  fill: number;
  /** Stroke width in CSS pixels; scaled by the device pixel ratio here. */
  width: number;
  /** Canvas `r,g,b` body. */
  rgb: string;
  alpha: number;
}

export interface RingMood {
  /** Orb radius in device pixels. */
  radius: number;
  /** The shared rotation the three dials divide up. */
  spin: number;
  /** Eased 0..1 microphone swell. */
  listening: number;
  /** The live voice envelope — brightens the dials and kicks them outward. */
  voice: number;
}

/**
 * The three dials, outer → inner: a bold segmented one, five long ticks, and a
 * fine fast ring. Geometry lives beside the stroke so the whole look of the
 * dial set is one file.
 */
export function ringGeometry(
  mood: RingMood,
  palette: OrbPalette,
): SegmentedRing[] {
  const { radius, spin, listening, voice } = mood;
  const lift = listening * 0.3 + voice * 0.5;
  const push = 1 + voice * 0.06;
  return [
    {
      radius: radius * 1.46 * push,
      rotation: spin * 0.7,
      segments: 22,
      fill: 0.62,
      width: 3.2 + voice * 3,
      rgb: palette.rings[0],
      alpha: Math.min(1, 0.85 + lift),
    },
    {
      radius: radius * 1.62 * push,
      rotation: -spin * 0.5,
      segments: 5,
      fill: 0.1,
      width: 5,
      rgb: palette.rings[1],
      alpha: Math.min(1, 0.9 + lift),
    },
    {
      radius: radius * 1.3 * push,
      rotation: spin * 1.6,
      segments: 60,
      fill: 0.5,
      width: 1.2,
      rgb: palette.rings[2],
      alpha: Math.min(1, 0.5 + lift),
    },
  ];
}

/**
 * The demo stroked (and shadow-blurred) every segment separately — 87 blurred
 * strokes a frame across the three dials, by far the loop's hot spot. Batching
 * all segments of one dial into a single path collapses that to three blur
 * passes a frame for a near-identical result — the segments' glows no longer
 * accumulate onto each other, so the dial reads a touch cleaner rather than
 * different. An explicit `moveTo` at each segment's start angle keeps `arc`
 * from line-to-ing the previous segment, which would close the gaps and turn
 * the dial into a polygon.
 */
export function strokeSegmentedRing(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  ring: SegmentedRing,
  devicePixelScale: number,
): void {
  const { radius, rotation, segments, fill, rgb, alpha } = ring;
  context.save();
  context.lineWidth = ring.width * devicePixelScale;
  context.lineCap = "round";
  context.shadowColor = `rgba(${rgb},0.9)`;
  context.shadowBlur = 10 * devicePixelScale;
  context.strokeStyle = `rgba(${rgb},${alpha})`;
  const step = (Math.PI * 2) / segments;
  context.beginPath();
  for (let i = 0; i < segments; i++) {
    const start = rotation + i * step;
    context.moveTo(
      centerX + radius * Math.cos(start),
      centerY + radius * Math.sin(start),
    );
    context.arc(centerX, centerY, radius, start, start + step * fill);
  }
  context.stroke();
  context.restore();
}
