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

/** A script writes “39 percent” and the voice says it that way, so nothing
 *  carries a % sign — the board read “EMAIL OPEN RATE 39”, a number with its
 *  unit chopped off (Chad, 2026-08-30). Matched ahead of the bare number so
 *  the unit is never lost. */
const PERCENT_SPOKEN = /\d+(?:\.\d+)?\s*per\s?cent\b/i;
const PERCENT_UNIT = /\s*per\s?cent\b/i;

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
  "for",
  "from",
  "of",
  "on",
  "to",
  // Who did it, and the verb of doing it — never the story.
  "we",
  "our",
  "they",
  "you",
  "it",
  "booked",
  "made",
  "saw",
  "got",
  "pulled",
  "brought",
  "added",
  "closed",
  "drove",
  "earned",
  "sold",
  "logged",
  "posted",
  "pushed",
  "shipped",
  "went",
  "just",
  "over",
  "since",
  // The rest of the pronouns: "We sold 42 of THEM" labelled itself "Them".
  "them",
  "us",
  "me",
  "my",
  "your",
  "their",
  "its",
  // More verbs of reporting: "21 new mastermind members JOINED today" kept
  // the verb as a third word and the label truncated to “Mastermind members
  // jo…”.
  "joined",
  "signed",
  "registered",
  "arrived",
  "finished",
  "started",
  "held",
  "holding",
]);

/** What a report line DOES with its figure. When no subject can be found on
 *  either side, the verb is the honest headline: “We booked $1,896 since this
 *  morning” has no noun to hang on, and read the other way it came out
 *  “$1,896 SINCE” (Chad, 2026-08-30). “$1,896 BOOKED” is what the sentence
 *  actually says. */
const REPORT_VERBS = [
  "booked",
  "sold",
  "made",
  "earned",
  "closed",
  "added",
  "logged",
  "drove",
  "brought",
  "pulled",
  "shipped",
  "posted",
];

/** The subject nearest the figure, wherever it sits. `projectNames` win when
 *  one is named in the line: the product IS the story on a nodes line. */
export function highlightLine(
  text: string,
  projectNames: readonly string[] = [],
): DemoLineHighlight | null {
  const match =
    MONEY.exec(text) ??
    PERCENT.exec(text) ??
    PERCENT_SPOKEN.exec(text) ??
    NUMBER.exec(text);
  if (match === null) return null;

  const named = projectNames.find((name) =>
    text.toLowerCase().includes(name.toLowerCase()),
  );
  // "Sales came in at $X" carries its subject BEFORE the figure; "225 quiz
  // submissions came through" carries it AFTER. Without the second read every
  // number-first line labelled itself "Update", which on camera looked like
  // the board simply not changing (Chad, 2026-08-29).
  const before = text.slice(0, match.index);
  const label =
    named ??
    subjectWords(before) ??
    subjectWords(text.slice(match.index + match[0].length), AFTER_FIGURE_SKIPS) ??
    reportVerb(before) ??
    "Update";
  return { label: clip(capitalize(label)), value: writeFigure(match[0]) };
}

/** The verb the line used, when nothing else will do. */
function reportVerb(before: string): string | null {
  const words = before.toLowerCase().match(/[a-z']+/g) ?? [];
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    if (word !== undefined && REPORT_VERBS.includes(word)) return word;
  }
  return null;
}

/** How far past the figure a subject may sit before it stops being one.
 *  “$911 IN sales” is one filler word away and is the subject; “$1,896 since
 *  this morning, and it's still climbing” is a clause, and skipping deeper to
 *  find a keeper pulled words out of the middle of the sentence — which is
 *  how “$1,896 SINCE” reached the screen (Chad, 2026-08-30). Before the
 *  figure there is no such limit: a subject there leads the sentence. */
const AFTER_FIGURE_SKIPS = 1;

/** “We've” is “we” wearing a contraction, and the stop list only knew the
 *  bare pronoun — so “We've pulled 467 leads” put WE'VE on camera under the
 *  figure (Chad, 2026-08-30). Everything before the apostrophe is the word
 *  that matters. */
function bareWord(word: string): string {
  const apostrophe = word.search(/['’]/);
  return (apostrophe === -1 ? word : word.slice(0, apostrophe)).toLowerCase();
}

/** The figure as the screen should show it: the spoken unit becomes its sign,
 *  and the spacing goes. */
function writeFigure(figure: string): string {
  return figure.replace(PERCENT_UNIT, "%").replace(/\s+/g, "");
}

function subjectWords(
  fragment: string,
  maxLeadingSkips = Number.POSITIVE_INFINITY,
): string | null {
  const words = fragment
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const kept: string[] = [];
  let skipped = 0;
  for (const word of words) {
    // Filler ends the subject once one has started; before that it is skipped
    // — but only so far.
    if (STOP_WORDS.has(bareWord(word))) {
      if (kept.length > 0) break;
      skipped += 1;
      if (skipped > maxLeadingSkips) return null;
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
