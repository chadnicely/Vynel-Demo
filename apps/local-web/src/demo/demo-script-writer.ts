import type { DemoProject } from "./demo-fleet.js";
import { findMentionedProject } from "./demo-fleet.js";
import { applyMetricRules, rollTakeMetrics, type MetricRule } from "./demo-rules.js";

// The demo routine's WORDS, in two kinds (Chad, 2026-08-28):
//
//   HUD lines      the assistant talking — "the team's been busy, here's where
//                  everything stands". They name NO software, they come from
//                  the shared Update Samples bank, and they play on the orb.
//   SOFTWARE lines one product's real update, pasted into that product's own
//                  box straight out of its Claude Code session. They play on
//                  the NODE screen with that product's dot lit.
//
// A take alternates the two, which is what makes the film move: orb, node,
// node, orb, node. The `surface` on each line is what the routine reads to
// decide which screen the camera is on when it speaks.
//
// Numbers come from the Rules ({sales}, {leads}) and are rolled ONCE per take,
// so a video never contradicts its own figures. Variety comes from the
// caller's `random` — Math.random in the app, a fixed sequence in tests.

/** Which screen is up while this line is spoken. */
export type DemoLineSurface = "hud" | "nodes";

export interface DemoScriptLine {
  readonly text: string;
  /** The product this line lights; null on every HUD line. */
  readonly projectId: string | null;
  readonly surface: DemoLineSurface;
  /** The RAW update this line was written from, exactly as it sits in the
   *  product's box — null on HUD lines. This is what "already used" is
   *  tracked by: the spoken text has the name and the numbers folded in, so
   *  it could never be matched back to the box. */
  readonly sourceUpdate: string | null;
}

/** "Hey Chad, the team is hard at work…" — one per take, so no two videos
 *  open on the same sentence. */
const GREETINGS: readonly string[] = [
  "Hey Chad — the team is hard at work, and everything is on plan.",
  "Welcome back Chad. The fleet is busy, and everything is tracking green.",
  "Hey Chad, good timing — every project is moving, and nothing needs your attention.",
  "Hey Chad — work never stopped. Here's where everything stands.",
  "Hey boss — all teams reporting in, and the plan is holding.",
  "Chad, good to see you. Everything is in motion, exactly as planned.",
  "Hey Chad — the overnight runs finished clean, and the board looks great.",
  "All quiet on the alerts, Chad — and the projects are stacking wins.",
  "Hey Chad. The whole fleet is in orbit, and every project is moving.",
  "Hey Chad — momentum is strong today. Here's the rundown.",
  "Standing by, Chad. The fleet is live and the numbers look good.",
  "Hey Chad — nothing on fire, plenty shipping. Here's the latest.",
  "Good day, Chad. The whole operation is running smooth and on plan.",
  "Hey Chad — teams are deep in the work, and the timeline is safe.",
  "Chad — updates are in from every crew, and it's all good news.",
  "Hey Chad. Every workspace reported in, and the news is good.",
];

/** One top-level idea in the HUD bank — "Sales", "Leads" — and its lines. A
 *  take draws from different ones so a video covers more than one theme. */
export interface UpdateCategory {
  readonly id: string;
  readonly label: string;
  readonly samples: readonly string[];
}

/** The HUD bank as shipped. NO software names anywhere — this is the
 *  assistant's own voice, and a product is named only by its own update. */
export const DEFAULT_UPDATE_CATEGORIES: readonly UpdateCategory[] = [
  {
    id: "sales",
    label: "Sales",
    samples: [
      "Sales came in at {sales} across the board today.",
      "We booked {sales} since this morning, and it's still climbing.",
      "Revenue is pacing about twenty percent ahead of last month.",
      "The new pricing is live everywhere, and upgrades are up.",
    ],
  },
  {
    id: "leads",
    label: "Leads",
    samples: [
      "{leads} new leads came in this week.",
      "We've pulled {leads} leads since Monday.",
      "Email open rate is holding at {open-rate} percent.",
      "Click-through is up nine percent on the new campaign.",
    ],
  },
  {
    id: "mastermind",
    label: "Mastermind",
    samples: [
      "{members} new mastermind members joined today.",
      "{quiz-submissions} quiz submissions came through overnight.",
      "Member retention is the highest it has been all year.",
      "Last night's coaching call had record attendance.",
    ],
  },
  {
    // THE HANDOFF (Chad, 2026-08-28: "an intro into the software"). One of
    // these is always spoken as the last thing on the orb, right before the
    // film cuts to the node screen — so the updates arrive announced rather
    // than as a jump cut. Edited here like any other bank line.
    id: "dev-intro",
    label: "Into the dev updates",
    samples: [
      "Here are this week's dev updates.",
      "Here's what the build teams shipped.",
      "Let me take you through the dev updates.",
      "Here's where every product landed this week.",
      "Now — the development updates.",
      "Here's what went out across the fleet.",
    ],
  },
  {
    // THE CLOSE. Always the last line of a take, back on the orb once the
    // whole board is lit — the frame the video ends on.
    id: "conclusion",
    label: "Conclusion",
    samples: [
      "That's your fleet, Chad — all of it running itself.",
      "Every team shipped, and nothing needs you. That's the whole update.",
      "That's the week: seven products moving, none of them waiting on you.",
      "All of it built, tested and live. Back to you, Chad.",
      "That's your operation, running while you were out.",
      "Everything on plan, everything shipped. I'll keep watching.",
    ],
  },
  {
    id: "operations",
    label: "Operations",
    samples: [
      "Every build is green, and monitoring has been quiet all night.",
      "The overnight runs finished clean — nothing needs a decision.",
      "Support is at inbox zero, and reviews are trending up.",
      "The whole fleet is on schedule, and nothing is blocked.",
      "Here's what the crews shipped while you were out.",
    ],
  },
];

/** The two categories the routine SPEAKS but never writes into a script: the
 *  handoff into the dev updates, and the closing line. They are the take's
 *  furniture — like the greeting — so the card shows only the content Chad
 *  actually reads (2026-08-28), while both stay editable in the bank. */
export const INTRO_CATEGORY_ID = "dev-intro";
export const CONCLUSION_CATEGORY_ID = "conclusion";
const FRAMING_IDS: readonly string[] = [INTRO_CATEGORY_ID, CONCLUSION_CATEGORY_ID];

export function isFramingCategory(categoryId: string): boolean {
  return FRAMING_IDS.includes(categoryId);
}

/** The lines a take's body may draw from — the bank minus its framing. */
export function bodyCategories(
  categories: readonly UpdateCategory[],
): UpdateCategory[] {
  return categories.filter((category) => !isFramingCategory(category.id));
}

/** One category's lines, or an empty list when it has been deleted. */
export function categorySamples(
  categories: readonly UpdateCategory[],
  categoryId: string,
): readonly string[] {
  return categories.find((category) => category.id === categoryId)?.samples ?? [];
}

/** The whole HUD bank as one flat pool. */
export function flattenUpdateSamples(
  categories: readonly UpdateCategory[],
): string[] {
  return categories.flatMap((category) => [...category.samples]);
}

/** Pick one framing line — the same deterministic draw the greeting uses. */
export function pickFramingLine(
  categories: readonly UpdateCategory[],
  categoryId: string,
  takeMetrics: ReadonlyMap<string, string>,
  random: () => number,
): string | null {
  const pool = categorySamples(categories, categoryId);
  return pool.length === 0 ? null : fillHudSample(pick(pool, random), takeMetrics);
}

function pick<T>(pool: readonly T[], random: () => number): T {
  return pool[Math.floor(random() * pool.length) % pool.length]!;
}

function shuffled<T>(pool: readonly T[], random: () => number): T[] {
  const drawn = [...pool];
  for (let i = drawn.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1)) % (i + 1);
    [drawn[i], drawn[j]] = [drawn[j]!, drawn[i]!];
  }
  return drawn;
}

export function pickDemoGreeting(random: () => number): string {
  return pick(GREETINGS, random);
}

/** Every greeting the routine could open with — the audio bank pre-records the
 *  whole pool, so whichever one the take draws is already on disk. */
export function allDemoGreetings(): readonly string[] {
  return GREETINGS;
}

function land(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/** One HUD line: the assistant's own words, with this take's numbers in. */
export function fillHudSample(
  sample: string,
  takeMetrics: ReadonlyMap<string, string> = new Map(),
): string {
  return land(applyMetricRules(sample, takeMetrics));
}

/** One SOFTWARE line: the update as Chad pasted it, made speakable. The
 *  product's name leads unless the update already says it — the viewer has to
 *  know which dot just lit up. Rule slots work here too, so a pasted update
 *  can carry a rolled number like any other line. */
export function fillProjectUpdate(
  update: string,
  project: DemoProject,
  takeMetrics: ReadonlyMap<string, string> = new Map(),
): string {
  const spoken = applyMetricRules(
    update.replaceAll("{name}", project.name).replaceAll("{purpose}", project.purpose.trim()),
    takeMetrics,
  ).trim();
  const named = findMentionedProject(spoken, [project]) !== null;
  return land(named ? spoken : `${project.name} — ${spoken}`);
}

/** Products with something real to say. Only these ever reach a take: a
 *  product with an empty box has no update, and inventing one is exactly what
 *  this box exists to stop. */
export function projectsWithUpdates(
  roster: readonly DemoProject[],
): DemoProject[] {
  return roster.filter((project) => project.updates.length > 0);
}

export interface WriteTakeOptions {
  readonly roster: readonly DemoProject[];
  readonly categories: readonly UpdateCategory[];
  readonly rules?: readonly MetricRule[];
  readonly random: () => number;
  /** How many SOFTWARE updates the take speaks — four at most (Chad,
   *  2026-08-28). */
  readonly softwareCount?: number;
  /** HUD lines before the film cuts to the products — the evening update. */
  readonly openerCount?: number;
  /** HUD lines after it cuts back — the couple of updates it closes on. */
  readonly closerCount?: number;
  /** Only these products may appear (ids). Empty/absent = any with updates. */
  readonly onlyProjectIds?: readonly string[] | undefined;
  /** Raw updates already spoken (or sitting in another queued take). A fresh
   *  one is always preferred; a product whose box is fully used falls back to
   *  its own list rather than dropping out of the film. */
  readonly usedUpdates?: ReadonlySet<string> | undefined;
  /** Software that MUST appear in every video, whatever the shuffle draws. */
  readonly alwaysProjectIds?: readonly string[] | undefined;
  /** STARRED update samples — HUD lines the user marked "say this every time"
   *  (Chad, 2026-08-28). They open the take, in the order given, before the
   *  shuffle picks anything. */
  readonly starredSamples?: readonly string[] | undefined;
}

/**
 * Write one take: a HUD line to open, then the software updates, with another
 * HUD line dropped in every couple of products so the film keeps cutting back
 * to the orb instead of sitting on the node screen for twenty seconds.
 */
export function writeDemoTake(options: WriteTakeOptions): DemoScriptLine[] {
  const {
    roster,
    categories,
    rules = [],
    random,
    softwareCount = 4,
    openerCount = 1,
    closerCount = 2,
    onlyProjectIds,
    usedUpdates,
    alwaysProjectIds = [],
    starredSamples = [],
  } = options;
  const takeMetrics = rollTakeMetrics(rules, random);
  const spoken = usedUpdates ?? new Set<string>();

  const eligible = projectsWithUpdates(roster).filter(
    (project) =>
      onlyProjectIds === undefined ||
      onlyProjectIds.length === 0 ||
      onlyProjectIds.includes(project.id),
  );
  // Products with something NEW to say go first, so a queue of ten takes
  // works through the boxes instead of circling the same three updates.
  const withFresh = eligible.filter((project) =>
    project.updates.some((update) => !spoken.has(update)),
  );
  const exhausted = eligible.filter(
    (project) => !project.updates.some((update) => !spoken.has(update)),
  );
  // Software the rules say must be in EVERY video takes its place first, then
  // the shuffle fills the rest of the slots.
  const mustFeature = eligible.filter((project) =>
    alwaysProjectIds.includes(project.id),
  );
  const rest = [...shuffled(withFresh, random), ...shuffled(exhausted, random)].filter(
    (project) => !alwaysProjectIds.includes(project.id),
  );
  const chosen = [...mustFeature, ...rest].slice(
    0,
    Math.max(softwareCount, mustFeature.length),
  );

  // HUD lines come from different top-level ideas, one idea per line — never
  // from the framing categories, which the routine speaks around the script.
  const stocked = bodyCategories(categories).filter(
    (category) => category.samples.length > 0,
  );
  const ideaOrder = shuffled(stocked, random);
  const usedHud = new Set<string>();
  let ideaCursor = 0;
  const nextHudLine = (): DemoScriptLine | null => {
    for (let attempt = 0; attempt < ideaOrder.length; attempt += 1) {
      const idea = ideaOrder[(ideaCursor + attempt) % ideaOrder.length];
      if (idea === undefined) break;
      const fresh = idea.samples.filter((sample) => !usedHud.has(sample));
      if (fresh.length === 0) continue;
      const sample = pick(fresh, random);
      usedHud.add(sample);
      ideaCursor += attempt + 1;
      return {
        text: fillHudSample(sample, takeMetrics),
        projectId: null,
        surface: "hud",
        sourceUpdate: null,
      };
    }
    return null;
  };

  const lines: DemoScriptLine[] = [];
  const takeUpdates = new Set<string>();

  // THE STARRED LINES (Chad, 2026-08-28: "click on the item that must always
  // be mentioned"). Every video says these — but they take their turn in the
  // HUD's slots rather than being dumped at the front, or a take with two
  // stars opened on three headlines before a product got a word in. Marked
  // used up front, so a generated line never repeats one.
  const starredQueue = [...starredSamples];
  for (const sample of starredQueue) usedHud.add(sample);

  /** The next thing the assistant says: a starred line while any are owed,
   *  otherwise a fresh one from the bank. */
  const nextHudSlot = (): DemoScriptLine | null => {
    const starred = starredQueue.shift();
    if (starred === undefined) return nextHudLine();
    return {
      text: fillHudSample(starred, takeMetrics),
      projectId: null,
      surface: "hud",
      sourceUpdate: null,
    };
  };

  // SOFTWARE GETS RESERVED SLOTS (Chad, 2026-08-28: "you don't have the
  // software coming in"). Starred lines and an opener used to be pushed first
  // and eat the whole budget, leaving the products crowded onto the end — or
  // off the take entirely once a few lines were starred. The remaining slots
  // are split instead, and the two kinds alternate into them, so a video is
  // always a conversation about real products rather than a run of headlines.
  const nextProjectLine = (project: DemoProject): DemoScriptLine => {
    // An unused update wins; a box with nothing fresh repeats rather than
    // leaving the product silent (better a seen line than a dead take).
    // `takeUpdates` is this take's own tally — the caller's set is never
    // mutated, so writing a take can be done twice with the same answer.
    const fresh = project.updates.filter(
      (update) => !spoken.has(update) && !takeUpdates.has(update),
    );
    const update = pick(fresh.length > 0 ? fresh : project.updates, random);
    takeUpdates.add(update);
    return {
      text: fillProjectUpdate(update, project, takeMetrics),
      projectId: project.id,
      surface: "nodes",
      sourceUpdate: update,
    };
  };

  // Half the take goes to products, rounded UP — Chad films software, so the
  // products get the larger half of a five-line video. Stars claim HUD slots
  // out of that same budget rather than lengthening the take; only a take
  // starred past its whole budget runs long, and even then one product slot
  // survives, because a demo reel with no software in it is not the video
  // being made.
  // THE SHAPE OF A TAKE (Chad, 2026-08-28): an evening update on the orb, ONE
  // cut to the products, then back to the orb to close on a couple more. Two
  // cuts, not four — each swap is a route change, and the earlier
  // trade-every-line version filmed badly. Starred lines take the HUD's slots
  // in order, so they land in the opener before the closer.
  const softwareSlots = Math.min(chosen.length, softwareCount);
  // Products with nothing to say hand their room back to the assistant, so a
  // take is a whole video even before a single update has been pasted in.
  const spareHud = softwareCount - softwareSlots;

  const speakHud = (slots: number): void => {
    for (let slot = 0; slot < slots; slot += 1) {
      const hudLine = nextHudSlot();
      if (hudLine === null) return; // a spent bank simply ends this stretch
      lines.push(hudLine);
    }
  };

  speakHud(openerCount + spareHud);
  for (let slot = 0; slot < softwareSlots; slot += 1) {
    lines.push(nextProjectLine(chosen[slot % chosen.length]!));
  }
  // Every star must be said even if the closer's own slots ran out first.
  speakHud(Math.max(closerCount, starredQueue.length));

  return lines;
}

/** Re-resolve a line the user EDITED — the text is theirs; naming a product
 *  makes it a node line, naming none makes it HUD talk. */
export function relinkEditedLine(
  text: string,
  roster: readonly DemoProject[],
  /** The raw update the line came from, kept across an edit so a reworded
   *  line still counts that update as used. */
  sourceUpdate: string | null = null,
): DemoScriptLine {
  const project = findMentionedProject(text, roster);
  return {
    text,
    projectId: project?.id ?? null,
    surface: project === null ? "hud" : "nodes",
    sourceUpdate: project === null ? null : sourceUpdate,
  };
}
