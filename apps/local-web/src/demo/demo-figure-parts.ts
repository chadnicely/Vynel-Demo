// Split a spoken figure into the bit that can count and the bits that cannot.
// "$1,508" rolls its 1508 and keeps its "$"; "29%" rolls its 29 and keeps its
// "%"; "3.2k" rolls its 3.2 and keeps its "k". Anything with no number in it
// is left exactly as written rather than mangled into a zero.

export interface DemoFigureParts {
  readonly prefix: string;
  readonly amount: number;
  readonly suffix: string;
  /** How many decimals the written figure showed — "3.2k" must not roll to
   *  "3.234k" on its way up. */
  readonly decimals: number;
  /** Whether the written figure grouped its thousands, so the roll matches. */
  readonly grouped: boolean;
}

const FIGURE = /^(?<prefix>[^\d]*)(?<digits>[\d,]*\d(?:\.\d+)?)(?<suffix>.*)$/s;

export function figureParts(value: string): DemoFigureParts | null {
  const groups = FIGURE.exec(value)?.groups;
  if (groups === undefined) return null;
  const { prefix = "", digits = "", suffix = "" } = groups;
  const amount = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const dot = digits.indexOf(".");
  return {
    prefix,
    amount,
    suffix,
    decimals: dot === -1 ? 0 : digits.length - dot - 1,
    grouped: digits.includes(","),
  };
}

/** One frame of the roll, written the way the finished figure is written. */
export function formatFigure(parts: DemoFigureParts, amount: number): string {
  const body = parts.grouped
    ? amount.toLocaleString("en-US", {
        minimumFractionDigits: parts.decimals,
        maximumFractionDigits: parts.decimals,
      })
    : amount.toFixed(parts.decimals);
  return `${parts.prefix}${body}${parts.suffix}`;
}

/** What KIND of figure this is, so the room can take its colour from the topic
 *  (Chad, 2026-08-29: gold on money, its own colour on a rate). The tone is a
 *  tint on the figure and its glow — never a re-theme of the room, which
 *  mid-take would read as a cut to different footage. */
export type DemoFigureTone = "money" | "rate" | "count";

export function figureTone(value: string): DemoFigureTone {
  if (value.trimStart().startsWith("$")) return "money";
  return value.trimEnd().endsWith("%") ? "rate" : "count";
}
