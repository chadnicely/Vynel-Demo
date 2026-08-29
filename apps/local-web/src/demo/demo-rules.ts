// The RULES: how big a number is allowed to get when a take speaks one
// (Chad, 2026-08-28 — "sales need to range between $400 and $2300"). Each rule
// owns a slot: an update line writes `{sales}` and every take rolls a fresh
// number inside the range for it, so the same sentence never films twice with
// the same figure and no figure is ever out of character for the business.
//
// Pure and deterministic under the caller's `random`: the film wants a new
// number per take, a test wants the same one twice.

export interface MetricRule {
  /** Stable slug — also the slot an update line writes: `{sales}`. */
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Money reads with a dollar sign; plain is a bare count. */
  readonly money: boolean;
  /** The rule was typed with a percent sign — carried so the box gives the
   *  user's own line back, and so a spoken figure can wear the sign too. */
  readonly percent?: boolean;
}

export const DEFAULT_METRIC_RULES: readonly MetricRule[] = [
  { id: "sales", label: "Sales", min: 400, max: 2300, money: true },
  { id: "leads", label: "Leads", min: 375, max: 1200, money: false },
  { id: "quiz-submissions", label: "Quiz submissions", min: 40, max: 600, money: false },
  { id: "members", label: "Mastermind members", min: 3, max: 25, money: false },
  { id: "open-rate", label: "Open rate percent", min: 22, max: 48, money: false },
];

export function metricSlot(rule: MetricRule): string {
  return `{${rule.id}}`;
}

/** Slug a typed label into a slot id — the same rule the roster uses. */
export function metricRuleId(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "metric"
  );
}

/** One number inside the rule's range, inclusive. A range entered backwards
 *  (max below min) still yields a number in it rather than NaN — the screen
 *  lets any two numbers be typed, and a take must never speak "NaN leads". */
export function rollMetric(rule: MetricRule, random: () => number): number {
  const low = Math.min(rule.min, rule.max);
  const high = Math.max(rule.min, rule.max);
  return low + Math.floor(random() * (high - low + 1));
}

/** How the voice should see it: grouped digits, with a dollar sign for money.
 *  Kokoro reads "$1,450" and "842" naturally, so the numbers stay as digits
 *  while the hand-written parts of the bank stay spelled out. */
export function formatMetric(rule: MetricRule, value: number): string {
  const grouped = value.toLocaleString("en-US");
  return rule.money ? `$${grouped}` : grouped;
}

/** The same figure as the SCREEN should show it — with the percent sign the
 *  user typed. Deliberately not what a take speaks: the update line owns that
 *  word ("holding at {open-rate} percent"), and a spoken "43% percent" is the
 *  sentence this split exists to prevent. */
export function displayMetric(rule: MetricRule, value: number): string {
  const shown = formatMetric(rule, value);
  return rule.percent === true ? `${shown}%` : shown;
}

/** The numbers ONE take will speak: each rule rolled once, reused everywhere
 *  it appears (Chad, 2026-08-28 — "consistent with what we actually do").
 *  A video that says "$800 in sales" in one breath and "$2,100 in sales" in
 *  the next is a video nobody believes; within a take, a figure is a fact. */
export function rollTakeMetrics(
  rules: readonly MetricRule[],
  random: () => number,
): Map<string, string> {
  return new Map(
    rules.map((rule) => [
      metricSlot(rule),
      formatMetric(rule, rollMetric(rule, random)),
    ]),
  );
}

/** Fill every `{slot}` a line carries from this take's rolled numbers. An
 *  unknown slot is left ALONE rather than blanked: a visible `{typo}` on the
 *  script screen is a rule that needs writing, where an empty gap would just
 *  read as a broken sentence. */
export function applyMetricRules(
  text: string,
  takeMetrics: ReadonlyMap<string, string>,
): string {
  let filled = text;
  for (const [slot, value] of takeMetrics) {
    filled = filled.replaceAll(slot, value);
  }
  return filled;
}

// ── The typed format ────────────────────────────────────────────────────────
// Rules are edited as TEXT, one per line (Chad, 2026-08-28 — he asked whether
// a sentence or `leads: 300-1200` was better, and the labelled range wins:
// nothing interprets these at film time, a generator rolls inside them, so a
// range that can be read exactly beats a sentence that has to be guessed at).
//
//   leads: 300-1200            a plain count
//   sales: $434 - 2340         money, from the dollar sign
//   quiz submissions: up to 600   an open low end
//
// Commas in the numbers are fine; so is "to" instead of a dash.

// Trailing units are allowed and ignored for the roll — "22%-48%" is a range
// like any other, and a line that silently vanished for wearing a percent sign
// was the one failure mode this format could not afford (the box would look
// saved and the rule would simply not exist).
const RULE_LINE =
  /^(.+?):\s*(?:(up\s+to|no\s+more\s+than|not\s+over|under|below|max)\s*)?\$?\s*([\d,]+)\s*%?(?:\s*(?:-|–|—|to)\s*\$?\s*([\d,]+)\s*%?)?\s*$/i;

/** A "not over 600" ceiling with no floor given. Kept WIDE on purpose: the
 *  user named one end, so the other is the tool's to pick, and a floor near
 *  the ceiling would make every take say nearly the same number. One-tenth
 *  reads as "anything up to 600" while never reporting zero. */
function flooredCeiling(ceiling: number): [number, number] {
  return [Math.max(1, Math.round(ceiling / 10)), ceiling];
}

export interface ParsedMetricRules {
  readonly rules: MetricRule[];
  /** Lines that could not be read — surfaced, never swallowed. */
  readonly unreadable: string[];
}

/** Parse the whole box, reporting what it could not read. A line that makes
 *  no sense is never guessed at: a half-typed rule must not become a filmed
 *  number, and it must not disappear without saying so either. */
export function parseMetricRuleLines(text: string): ParsedMetricRules {
  const rules: MetricRule[] = [];
  const unreadable: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = line.match(RULE_LINE);
    if (match === null) {
      unreadable.push(line);
      continue;
    }
    const [, label, capped, first, second] = match;
    const low = Number(first!.replace(/,/g, ""));
    const high = second === undefined ? undefined : Number(second.replace(/,/g, ""));
    if (!Number.isFinite(low)) {
      unreadable.push(line);
      continue;
    }
    const [min, max] =
      capped !== undefined ? flooredCeiling(low) : [low, high ?? low];
    const id = metricRuleId(label!);
    if (rules.some((rule) => rule.id === id)) continue;
    rules.push({
      id,
      label: label!.trim(),
      min,
      max,
      money: line.includes("$"),
      // Remembered so the round trip gives the user back their own line.
      percent: line.includes("%"),
    });
  }
  return { rules, unreadable };
}

/** The rules alone — the common read. */
export function parseMetricRules(text: string): MetricRule[] {
  return parseMetricRuleLines(text).rules;
}

/** Back to text, exactly as the box should read it — so the round trip is
 *  lossless and the user's own typing is what they see next time. */
export function formatMetricRules(rules: readonly MetricRule[]): string {
  return rules
    .map(
      (rule) =>
        `${rule.label}: ${displayMetric(rule, rule.min)}-${displayMetric(rule, rule.max)}`,
    )
    .join("\n");
}
