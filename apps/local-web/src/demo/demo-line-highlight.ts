// Pull the HEADLINE out of a spoken line, for the Display's board
// (Chad, 2026-08-29: "match the highlights of what's being said so the
// audience can take note"). A viewer half-listening should be able to read
// "Sales came in · $2,300" off the board while the voice says the sentence
// around it.

export interface DemoLineHighlight {
  readonly label: string;
  readonly value: string;
}

/** Money first, then percents, then bare numbers — the order a claim's
 *  headline usually takes ("$2,300 in sales" beats the "3" in "3 days"). */
const MONEY = /\$[\d][\d,]*(?:\.\d+)?\s*[kKmM]?/;
const PERCENT = /\d+(?:\.\d+)?\s*%/;
const NUMBER = /\b\d[\d,]*(?:\.\d+)?\b/;

const LABEL_MAX = 22;

/** Verbs and time filler that ride beside a subject — "quiz submissions CAME
 *  THROUGH OVERNIGHT" — and must not end up on the board. */
const STOP_WORDS = new Set([
  "came",
  "come",
  "hit",
  "landed",
  "rolled",
  "through",
  "in",
  "up",
  "at",
  "this",
  "that",
  "tonight",
  "today",
  "overnight",
  "week",
  "are",
  "is",
  "was",
  "were",
  "the",
  "and",
  "with",
  "new",
]);

/** The subject nearest the figure, wherever it sits. `projectNames` win when
 *  one is named in the line: the product IS the story on a nodes line. */
export function highlightLine(
  text: string,
  projectNames: readonly string[] = [],
): DemoLineHighlight | null {
  const match = MONEY.exec(text) ?? PERCENT.exec(text) ?? NUMBER.exec(text);
  if (match === null) return null;

  const named = projectNames.find((name) =>
    text.toLowerCase().includes(name.toLowerCase()),
  );
  // "Sales came in at $X" carries its subject BEFORE the figure; "225 quiz
  // submissions came through" carries it AFTER. Without the second read every
  // number-first line labelled itself "Update", which on camera looked like
  // the board simply not changing (Chad, 2026-08-29).
  const label =
    named ??
    subjectWords(text.slice(0, match.index)) ??
    subjectWords(text.slice(match.index + match[0].length)) ??
    "Update";
  return { label: clip(capitalize(label)), value: match[0].replace(/\s+/g, "") };
}

function subjectWords(fragment: string): string | null {
  const words = fragment
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const kept: string[] = [];
  for (const word of words) {
    // Filler ends the subject once one has started; before that it is skipped.
    if (STOP_WORDS.has(word.toLowerCase())) {
      if (kept.length > 0) break;
      continue;
    }
    kept.push(word);
    if (kept.length === 3) break;
  }
  return kept.length === 0 ? null : kept.join(" ");
}

function capitalize(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function clip(label: string): string {
  return label.length <= LABEL_MAX ? label : `${label.slice(0, LABEL_MAX - 1)}…`;
}
