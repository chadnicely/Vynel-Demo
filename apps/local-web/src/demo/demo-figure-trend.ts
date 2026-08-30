// The little "▲ up 18% from yesterday" and its sparkline, beside a spoken
// figure on the film set (Chad, 2026-08-29: make it magical on camera).
//
// THIS IS SET DRESSING, and only the demo may use it. A take's numbers are
// written by hand into a script; there is no yesterday to compare them to, so
// the shape of the week is derived from the figure itself. It is DERIVED, not
// drawn: the same figure gets the same trend every take, so a clip re-shot
// after lunch cuts against the morning's footage without the graph changing
// under it. Nothing outside `demo/` may import this — real numbers get real
// history or none.

import { figureTone } from "./demo-figure-parts.js";

export interface DemoFigureTrend {
  readonly direction: "up" | "down";
  /** Spoken-English delta for the caption — "up 18% from yesterday". */
  readonly caption: string;
  /** Seven points, 0..1, oldest first. The last one is always the figure. */
  readonly points: readonly number[];
}

const POINTS = 7;

/** A stable 32-bit hash, so one figure's trend never changes between takes. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic 0..1 stream off one seed — enough jitter that the line
 *  looks measured rather than drawn with a ruler. */
function* stream(seed: number): Generator<number> {
  let state = seed || 1;
  for (;;) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    yield state / 0xffffffff;
  }
}

export function figureTrend(label: string, value: string): DemoFigureTrend {
  const rolls = stream(hash(`${label}\u0000${value}`));
  // A film set is a good day. Money and counts — the figures a take leads
  // with — always climb: a down arrow on the hero number is the one frame
  // nobody wants in the cut. A rate is a share of something and reads as
  // measured rather than boasted, so it is allowed its off day one time in
  // five.
  const direction =
    figureTone(value) !== "rate" || rolls.next().value < 0.8 ? "up" : "down";
  const magnitude = 4 + Math.round(rolls.next().value * 24);

  // Walk backwards from today to the start of the week, so the last point is
  // always the figure being spoken and the climb lands on it.
  const total = direction === "up" ? magnitude / 100 : -magnitude / 100;
  const points: number[] = [];
  for (let i = 0; i < POINTS; i += 1) {
    const progress = i / (POINTS - 1);
    const jitter = (rolls.next().value - 0.5) * 0.16;
    points.push(1 - total * (1 - progress) + (i === POINTS - 1 ? 0 : jitter));
  }

  const low = Math.min(...points);
  const high = Math.max(...points);
  const span = high - low || 1;
  return {
    direction,
    caption: `${direction === "up" ? "up" : "down"} ${magnitude}% from yesterday`,
    points: points.map((point) => (point - low) / span),
  };
}

/** The sparkline path for a 0..1 series, drawn into `width` × `height`. */
export function trendPath(
  points: readonly number[],
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";
  const step = width / (points.length - 1 || 1);
  return points
    .map((point, index) => {
      const x = (index * step).toFixed(1);
      const y = (height - point * height).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}
