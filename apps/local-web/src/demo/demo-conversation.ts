// THE CONVERSATION (Chad, 2026-08-30). A filmed take is four exchanges, and
// the assistant OFFERS before it delivers:
//
//   1. "What's up Pacino"   → "Morning — sales are ahead. Want your updates?"
//   2. "Yeah, go on"        → the numbers
//   3. "How's dev looking?" → "Superb — busy with Mintbird. Let me pull the log."
//   4. "Thanks Pacino"      → the sign-off                             → black
//
// It used to answer with three sentences that never changed, and it launched
// into the report without being asked. Ten takes opened on the same six words.
//
// A HUNDRED VIDEOS is the requirement (Chad, 2026-08-30), so a pool of stock
// sentences is not enough — five openers across a hundred takes is each one
// twenty times. Every line is BUILT instead, from three interchangeable parts,
// which puts the number of distinct openings in the hundreds. The take also
// refuses any line already used by another take in the queue, so the repeats
// that remain are ones nobody will live to see.
//
// WRITTEN FROM THE TAKE. The parts are chosen against that take's own content
// — the products it covers, whether it has money in it — so the wording is not
// merely different, it is true: "sales are already ahead" only ever opens a
// take that has sales in it.
//
// Composed when the take is WRITTEN, never while filming. The lines are
// recorded with the rest of it so the reply is instant on camera; writing a
// sentence live costs five to ten seconds of a man standing in front of a lens
// saying nothing, which is the whole reason this film is pre-recorded.

import type { DemoScriptLine } from "./demo-script-writer.js";
import { highlightLine } from "./demo-line-highlight.js";
import {
  WRITTEN_CONVERSATIONS,
  type WrittenConversation,
} from "./demo-conversation-bank.js";

/** The four things the assistant says, for one take. */
export interface DemoConversation {
  /** Answers the intro and OFFERS the updates. */
  readonly opening: string;
  /** He said yes — the hand-in to the numbers. */
  readonly handover: string;
  /** He asked about the software; this covers the cut to the products. */
  readonly software: string;
  /** Said over the lit board, after the last product. It used to come from
   *  a separate pool, so every take in a reel ended on the same sentence
   *  however different the rest of it was (Chad, 2026-08-31). */
  readonly wrap: string;
  /** The sign-off. After it, black. */
  readonly closing: string;
}

// ── The parts ─────────────────────────────────────────────────────────────

const GREETINGS = [
  "Morning",
  "Hey boss",
  "Evening",
  "Good to see you",
  "Hey",
  "Right on time",
  "Perfect timing",
  "",
];

/** Only for a take that actually reports money. */
const STATUS_MONEY = [
  "sales are already ahead",
  "the money's moving nicely",
  "we're up on the day",
  "revenue's running ahead of yesterday",
  "takings are looking healthy",
  "the numbers are up",
];

const STATUS_PLAIN = [
  "everything's green",
  "all on track",
  "nothing needs you",
  "it's all running clean",
  "everything's behaving",
  "quiet night, all good",
  "no fires anywhere",
  "the whole fleet's steady",
];

const OFFERS = [
  "Want your updates?",
  "Shall I run your updates?",
  "Ready for the numbers?",
  "Want me to take you through it?",
  "Shall I give you the rundown?",
  "Want the update?",
  "Ready when you are — shall I?",
  "Want me to run through it?",
];

const HANDOVER_LEADS = [
  "Right",
  "Course",
  "Sure thing",
  "Of course",
  "Absolutely",
  "Sure",
  "You bet",
  "",
];

const HANDOVER_BODIES = [
  "here's where we landed",
  "here's how the day went",
  "this is what came in today",
  "here's the day",
  "here's what happened",
  "this is where we finished",
  "here's your day",
  "these are today's numbers",
];

/** THE DAY, never the week (Chad, 2026-08-30): this is a nightly update, and
 *  "strong week" on it is wrong on its face. */
const SOFTWARE_REACTIONS = [
  "Superb",
  "Really strong day",
  "Busy one",
  "Going well",
  "Good day",
  "Plenty done today",
  "Solid day",
  "Lots moved today",
  "Big day",
  "Productive one",
  "Cracking day",
  "Everyone was busy",
];

const SOFTWARE_HANDOFFS = [
  "Let me pull the dev log",
  "Here's the log",
  "Let me take you through it",
  "Here's the rundown",
  "Let me get the dev log",
  "Here's what shipped",
];

/** Whole sign-offs, in his voice (Chad, 2026-08-30 gave the first three).
 *  Built as sentences rather than lead + tail: the combinatorial version
 *  said "Happy to" every third take, because a lead that pairs with anything
 *  gets used with everything. */
const CLOSINGS = [
  "No problem, boss.",
  "Have a good one, Chad.",
  "I'll keep you updated.",
  "You got it, boss.",
  "Any time — I'll keep watch.",
  "Course. I'll shout if anything changes.",
  "Anything moves, you'll be the first to know.",
  "That's the lot. Have a good evening.",
  "All yours, Chad.",
  "I'll be here if anything comes up.",
  "No trouble at all.",
  "Consider it handled.",
  "I'll keep the lights on.",
  "Catch you later, Chad.",
  "Say the word if you need more.",
  "I'll flag anything that changes.",
  "Go enjoy your night, boss.",
  "Easy. I've got it from here.",
  "Whenever you need me, Chad.",
  "Done and dusted. Night, boss.",
  "Leave it with me.",
  "Sleep well — I'll be watching it.",
  "Sound. I'll keep it moving.",
  "Nice one, boss. Talk soon.",
];

// ── Building one ──────────────────────────────────────────────────────────

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic 0..n-1 stream off one seed. Deterministic on purpose: a
 *  take films the same way twice, so a clip re-shot after lunch cuts against
 *  the morning's footage. */
function chooser(seed: number): (size: number) => number {
  let state = seed || 1;
  return (size: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % size;
  };
}

function sentence(parts: readonly string[]): string {
  const body = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" — ")
    .replace(/\s+—\s+—\s+/g, " — ");
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

function buildOpening(next: (size: number) => number, hasMoney: boolean): string {
  const greeting = GREETINGS[next(GREETINGS.length)]!;
  const status = hasMoney
    ? STATUS_MONEY[next(STATUS_MONEY.length)]!
    : STATUS_PLAIN[next(STATUS_PLAIN.length)]!;
  const offer = OFFERS[next(OFFERS.length)]!;
  const head = greeting.length > 0 ? `${greeting} — ${status}` : capitalize(status);
  return `${sentence([head])} ${offer}`;
}

function buildHandover(next: (size: number) => number): string {
  const lead = HANDOVER_LEADS[next(HANDOVER_LEADS.length)]!;
  const body = HANDOVER_BODIES[next(HANDOVER_BODIES.length)]!;
  return lead.length > 0
    ? sentence([`${lead}, ${body}`])
    : sentence([capitalize(body)]);
}

/** THE SUITE (Chad, 2026-08-30). The software has a name and the work has a
 *  story: everything he ships is the Titanium Suite, and what is exciting
 *  right now is the MCPs going into it. A dev hand-off that never mentions
 *  either is a hand-off about nothing. */
const SUITE = "the Titanium Suite";

/** BE ORIGINAL EVERY TIME (Chad, 2026-08-30). One template with the product
 *  names swapped is not variety — it is the same sentence a hundred times
 *  wearing different hats, and he spotted it immediately ("you don't always
 *  have to say we've been busy with this and this").
 *
 *  So the line is chosen from SHAPES. Each is a different sentence entirely —
 *  different rhythm, different thing being said, some naming one product, some
 *  two, some naming the suite, some leading on the MCP work. Twenty shapes
 *  against twelve reactions and six hand-offs is well past a hundred takes. */
/** “JuicyPops’s MCP” is a mouthful nobody says; a name already ending in s
 *  takes the bare apostrophe. */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

function softwareShapes(
  reaction: string,
  handoff: string,
  products: readonly string[],
): string[] {
  const one = products[0] ?? SUITE;
  const two = products[1] ?? null;
  const pair = two === null ? one : `${one} and ${two}`;
  const count = products.length;

  const shapes = [
    `${reaction} — ${possessive(one)} MCP went in today. ${handoff}.`,
    `${reaction}. ${SUITE} picked up more MCPs today. ${handoff}.`,
    `Where do I start — ${one} shipped${two === null ? "" : `, ${two} right behind`}. ${handoff}.`,
    `${reaction}. ${one} is where the hours went. ${handoff}.`,
    `${SUITE} has had a proper day. ${handoff}.`,
    `Good news — the MCP work landed on ${one}. ${handoff}.`,
    `${reaction} — ${pair} both moved. ${handoff}.`,
    `Quiet on most of it, but ${one} had a day. ${handoff}.`,
    `The MCPs are the story today, ${one} especially. ${handoff}.`,
    `Everything moved a little; ${one} moved a lot. ${handoff}.`,
    `${one} is in good shape now${two === null ? "" : `, and so is ${two}`}. ${handoff}.`,
    `${SUITE} is coming together — ${pair} landed today. ${handoff}.`,
    `${reaction}. Mostly MCP work, mostly ${one}. ${handoff}.`,
    `Real progress on ${one} today. ${handoff}.`,
    `${reaction} — we got ${one} over the line. ${handoff}.`,
    `${count > 1 ? `${count} of them moved today` : `${one} moved today`}. ${handoff}.`,
    `${one} took the day, and the MCPs came with it. ${handoff}.`,
    `${reaction}. ${SUITE} is a bit stronger tonight than it was this morning. ${handoff}.`,
    `Plenty of MCP work — ${pair} carried it. ${handoff}.`,
    `${one} finally clicked into place today. ${handoff}.`,
  ];
  return shapes;
}

function buildSoftware(
  next: (size: number) => number,
  products: readonly string[],
): string {
  const reaction = SOFTWARE_REACTIONS[next(SOFTWARE_REACTIONS.length)]!;
  const handoff = SOFTWARE_HANDOFFS[next(SOFTWARE_HANDOFFS.length)]!;
  const shapes = softwareShapes(reaction, handoff, products);
  return startSentences(shapes[next(shapes.length)]!);
}

/** A shape may open on the suite, whose name carries a lowercase “the” for
 *  mid-sentence use — “Productive one. the Titanium Suite…”. Sentences start
 *  with a capital wherever they start. */
function startSentences(line: string): string {
  return line.replace(/(^|[.!?]s+)([a-z])/g, (_m, lead: string, letter: string) =>
    `${lead}${letter.toUpperCase()}`,
  );
}

/** The backstop wrap, for a reel long enough to spend the written bank. */
const WRAPS = [
  "And that's the lot. Nothing waiting on you.",
  "That's the board. All of it ran itself.",
  "So that's your day — busy, and none of it needed you.",
  "Everything moved, nothing broke. I'll take that.",
  "That's everything. Tidier than it was this morning.",
  "Good day, that one.",
  "All done, and not a decision in sight.",
  "That's the fleet. Behaving itself.",
];

function buildWrap(
  next: (size: number) => number,
  products: readonly string[],
): string {
  const one = products[0];
  const withName =
    one === undefined
      ? []
      : [
          `That's the board. ${one} did the heavy lifting today.`,
          `And that's it — ${one} the standout.`,
          `${one} carried today. The rest ticked along.`,
        ];
  const pool = [...WRAPS, ...withName];
  return pool[next(pool.length)]!;
}

function buildClosing(next: (size: number) => number): string {
  return CLOSINGS[next(CLOSINGS.length)]!;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fill a written set's slots with this take's own software. */
function fill(line: string, products: readonly string[]): string {
  const one = products[0] ?? "the Suite";
  const other = products[1] ?? one;
  return line.replaceAll("{product}", one).replaceAll("{other}", other);
}

/** Write one take's conversation.
 *
 *  The WRITTEN bank comes first — those are real pieces of dialogue and they
 *  are what the film should sound like. Only when the bank has nothing left
 *  that fits does the take fall back to the built sentences, which exist so a
 *  hundredth video still has something to say rather than repeating the first.
 *
 *  `alreadyUsed` are the openings other takes in the queue already say, so a
 *  reel of a hundred does not open the same way twice. */
export function writeConversation(
  lines: readonly DemoScriptLine[],
  roster: readonly { readonly id: string; readonly name: string }[],
  seedText: string,
  alreadyUsed: ReadonlySet<string> = new Set(),
): DemoConversation {
  const hasMoney = lines.some(
    (line) =>
      line.surface !== "nodes" &&
      highlightLine(line.text)?.value.startsWith("$") === true,
  );
  // BY ID, not by reading the sentence. A line only starts with its product's
  // name when the pasted update did not already say it, so matching on the
  // text missed every update written as "we shipped the X rebuild" — and the
  // dev hand-off fell back to talking about nothing (Chad, 2026-08-31).
  const featured = [
    ...new Set(
      lines
        .filter((line) => line.surface === "nodes" && line.projectId !== null)
        .map(
          (line) =>
            roster.find((project) => project.id === line.projectId)?.name ?? null,
        )
        .filter((name): name is string => name !== null),
    ),
  ];

  const seed = hash(seedText);
  // A take with no money may not claim any: those sets are simply not offered.
  // A set that speaks of two products needs two: with one, {other} filled with
  // the same name and the line said “Quizforma is in good shape, and so is
  // Quizforma” (2026-09-01).
  const wantsTwo = (written: WrittenConversation): boolean =>
    [written.opening, written.handover, written.software, written.wrap, written.closing].some(
      (line) => line.includes("{other}"),
    );
  const eligible = WRITTEN_CONVERSATIONS.filter(
    (written) =>
      (hasMoney || written.needsMoney !== true) &&
      (featured.length >= 2 || !wantsTwo(written)),
  );
  // No line it says may already be said by another take in the queue — the
  // opener was deduped and the ENDING still repeated, which is the one he
  // heard every time (Chad, 2026-08-31; “more personal and real”, 09-01).
  const fresh = eligible.filter(
    (written) =>
      !alreadyUsed.has(fill(written.opening, featured)) &&
      !alreadyUsed.has(fill(written.wrap, featured)) &&
      !alreadyUsed.has(fill(written.closing, featured)),
  );
  const pool = fresh.length > 0 ? fresh : [];
  if (pool.length > 0) {
    const written = pool[seed % pool.length]!;
    return {
      opening: fill(written.opening, featured),
      handover: fill(written.handover, featured),
      software: fill(written.software, featured),
      wrap: fill(written.wrap, featured),
      closing: fill(written.closing, featured),
    };
  }

  // The bank is spent for this reel — build one.
  let conversation = FALLBACK_CONVERSATION;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const next = chooser(hash(`${seedText}#${attempt}`));
    conversation = {
      opening: buildOpening(next, hasMoney),
      handover: buildHandover(next),
      software: buildSoftware(next, featured),
      wrap: buildWrap(next, featured),
      closing: buildClosing(next),
    };
    if (
      !alreadyUsed.has(conversation.opening) &&
      !alreadyUsed.has(conversation.wrap) &&
      !alreadyUsed.has(conversation.closing)
    )
      break;
  }
  return conversation;
}

/** Every line of a conversation, for the recording pass. */
export function conversationLines(
  conversation: DemoConversation,
): readonly string[] {
  return [
    conversation.opening,
    conversation.handover,
    conversation.software,
    conversation.wrap,
    conversation.closing,
  ];
}

/** What a take written before conversations carried their own falls back to —
 *  the film must never go silent because a take predates a feature. */
export const FALLBACK_CONVERSATION: DemoConversation = {
  opening: "Everything's green — right on track. Want your updates?",
  handover: "Here's where we landed.",
  software: "Let me pull the dev log for you.",
  wrap: "And that's your board — all of it running itself.",
  closing: "Any time, boss.",
};
