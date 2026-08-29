import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  DISPLAY_COLOURS,
  DISPLAY_SHAPES,
} from "@vynel/ui";
import type { SceneMessage, SceneNode } from "../utils/constellation-scene.js";
import {
  DEMO_PROJECTS,
  demoFleetNodes,
  demoNodeId,
  findMentionedProject,
  makeDemoProject,
  type DemoProject,
} from "../demo/demo-fleet.js";
import {
  allDemoGreetings,
  categorySamples,
  CONCLUSION_CATEGORY_ID,
  DEFAULT_UPDATE_CATEGORIES,
  flattenUpdateSamples,
  INTRO_CATEGORY_ID,
  pickFramingLine,
  projectsWithUpdates,
  relinkEditedLine,
  writeDemoTake,
  type DemoScriptLine,
  type UpdateCategory,
} from "../demo/demo-script-writer.js";
import {
  DEFAULT_METRIC_RULES,
  formatMetricRules,
  parseMetricRuleLines,
  rollTakeMetrics,
  type MetricRule,
} from "../demo/demo-rules.js";
import { createDemoAudioBank } from "../demo/demo-audio.js";
import {
  readDemoArmedFlag,
  writeDemoArmedFlag,
} from "../demo/demo-armed-flag.js";
import { useUiStore } from "./ui-store.js";

// Demo Mode — the filmed routine's home (Chad, 2026-08-28). Scripts are
// written and pre-recorded HERE, ahead of the camera; the routine sequencer
// (use-demo-routine) only reads this store and plays. Client-only by design:
// nothing about a rehearsed film belongs in the API or the database.

/** Where a take stands in the queue. `pending` is written but unwatched;
 *  `approved` is cleared for camera — the routine only ever plays these, so a
 *  line nobody read can never end up in a video. */
export type DemoScriptStatus = "pending" | "approved";

export interface DemoScript {
  readonly id: string;
  readonly title: string;
  lines: DemoScriptLine[];
  status: DemoScriptStatus;
  readonly createdAt: number;
}

/** How many takes the queue holds ready (Chad, 2026-08-28: "10 in cue"). */
export const DEMO_QUEUE_TARGET = 10;

/** A take films in two halves, one per spoken trigger: the wake phrase plays
 *  the evening update, then a question about the software plays the products
 *  (Chad, 2026-08-28). */
export type TakePart = "opening" | "software";

const DEMO_SCRIPTS_STORAGE_KEY = "vynel.demo-scripts";
const DEMO_ACTIVE_SCRIPT_STORAGE_KEY = "vynel.demo-active-script";
const DEMO_ROSTER_STORAGE_KEY = "vynel.demo-projects";
const DEMO_SAMPLES_STORAGE_KEY = "vynel.demo-update-samples";
const DEMO_RULES_STORAGE_KEY = "vynel.demo-rules";
const DEMO_FILMED_STORAGE_KEY = "vynel.demo-filmed-updates";
const DEMO_ALWAYS_STORAGE_KEY = "vynel.demo-always";

/** The must-haves. Junk storage means none are set — a take without a tagline
 *  is a lesser video, never a broken one. */
function readStoredAlways(): { samples: string[]; projectIds: string[] } {
  const raw = localStorage.getItem(DEMO_ALWAYS_STORAGE_KEY);
  if (raw === null) return { samples: [], projectIds: [] };
  try {
    const parsed = JSON.parse(raw) as { samples?: unknown; projectIds?: unknown };
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((row): row is string => typeof row === "string") : [];
    return {
      samples: strings(parsed.samples),
      projectIds: strings(parsed.projectIds),
    };
  } catch {
    return { samples: [], projectIds: [] };
  }
}

/** Updates already spoken on camera. Junk storage simply means nothing has
 *  been filmed yet — the cost is one repeated line, never a broken screen. */
function readStoredFilmed(): string[] {
  const raw = localStorage.getItem(DEMO_FILMED_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as { filmed?: unknown };
    return Array.isArray(parsed.filmed)
      ? parsed.filmed.filter((line): line is string => typeof line === "string")
      : [];
  } catch {
    return [];
  }
}

/** The silent beat between spoken lines — also counted by the runtime badge,
 *  so the badge's number is the take's number. Deliberately short (Chad,
 *  2026-08-28: "the delay between the line items is too much"): the lines are
 *  pre-recorded, so the only pause is the one set here, and a demo reel wants
 *  the assistant to sound brisk rather than to breathe between sentences. */
export const DEMO_LINE_GAP_SECONDS = 0.08;

// Fail-closed like every stored value: junk storage is an empty library,
// never a poisoned one.
function readStoredScripts(): DemoScript[] {
  const raw = localStorage.getItem(DEMO_SCRIPTS_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    if (!Array.isArray(parsed.scripts)) return [];
    return parsed.scripts
      .filter(
        (script): script is DemoScript =>
          typeof (script as DemoScript).id === "string" &&
          typeof (script as DemoScript).title === "string" &&
          Array.isArray((script as DemoScript).lines),
      )
      // EVERY restored take is pending. Approving means "recorded and ready to
      // film", and the recordings are WAV blobs held in memory — a reload
      // wipes them. Coming back to cards that claimed to be approved with no
      // audio behind them was the confusion (Chad, 2026-08-28); the honest
      // state after a reload is the one before the button was pressed.
      .map((script) => ({ ...script, status: "pending" as const }));
  } catch {
    return [];
  }
}

// Fail-closed: junk storage falls back to the SEED roster, never to nothing —
// an empty software list would make every screen of the film kit dead-end.
function readStoredRoster(): DemoProject[] {
  const raw = localStorage.getItem(DEMO_ROSTER_STORAGE_KEY);
  if (raw === null) return [...DEMO_PROJECTS];
  try {
    const parsed = JSON.parse(raw) as { projects?: unknown };
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0)
      return [...DEMO_PROJECTS];
    return parsed.projects.filter(
      (project): project is DemoProject =>
        typeof (project as DemoProject).id === "string" &&
        typeof (project as DemoProject).name === "string" &&
        Array.isArray((project as DemoProject).aliases) &&
        typeof (project as DemoProject).purpose === "string",
    )
    // A roster stored before the update box existed simply has none yet.
    .map((project) => ({
      ...project,
      updates: Array.isArray(project.updates) ? project.updates : [],
    }));
  } catch {
    return [...DEMO_PROJECTS];
  }
}

/** Same fail-closed rule as the roster: junk (or an emptied bank) falls back
 *  to the shipped categories — a take with nothing to say is worse than a
 *  generic one. */
function readStoredCategories(): UpdateCategory[] {
  const raw = localStorage.getItem(DEMO_SAMPLES_STORAGE_KEY);
  if (raw === null) return DEFAULT_UPDATE_CATEGORIES.map((row) => ({ ...row }));
  try {
    const parsed = JSON.parse(raw) as { categories?: unknown };
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.filter(
          (category): category is UpdateCategory =>
            typeof (category as UpdateCategory).id === "string" &&
            typeof (category as UpdateCategory).label === "string" &&
            Array.isArray((category as UpdateCategory).samples),
        )
      : [];
    return categories.length > 0
      ? categories
      : DEFAULT_UPDATE_CATEGORIES.map((row) => ({ ...row }));
  } catch {
    return DEFAULT_UPDATE_CATEGORIES.map((row) => ({ ...row }));
  }
}

/** Same fail-closed rule as the roster and the bank. A rule missing its
 *  numbers is dropped rather than left to roll NaN into a filmed line. */
function readStoredRules(): MetricRule[] {
  const raw = localStorage.getItem(DEMO_RULES_STORAGE_KEY);
  if (raw === null) return DEFAULT_METRIC_RULES.map((rule) => ({ ...rule }));
  try {
    const parsed = JSON.parse(raw) as { rules?: unknown };
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.filter(
          (rule): rule is MetricRule =>
            typeof (rule as MetricRule).id === "string" &&
            typeof (rule as MetricRule).label === "string" &&
            Number.isFinite((rule as MetricRule).min) &&
            Number.isFinite((rule as MetricRule).max),
        )
      : [];
    return rules.length > 0 ? rules : DEFAULT_METRIC_RULES.map((rule) => ({ ...rule }));
  } catch {
    return DEFAULT_METRIC_RULES.map((rule) => ({ ...rule }));
  }
}

export const useDemoStore = defineStore("demo", () => {
  const ui = useUiStore();
  const bank = createDemoAudioBank();

  // ── The software roster ───────────────────────────────────────────────────
  // Chad's own list of products, each with its optional "possible updates"
  // pool. Every consumer (fleet dots, mention detection, the writer) reads
  // THIS list, so adding software here adds it everywhere at once.
  const projects = ref<DemoProject[]>(readStoredRoster());

  watch(
    projects,
    (value) =>
      localStorage.setItem(
        DEMO_ROSTER_STORAGE_KEY,
        JSON.stringify({ projects: value }),
      ),
    { deep: true },
  );

  function addProject(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const minted = makeDemoProject(trimmed);
    if (projects.value.some((project) => project.id === minted.id)) return;
    projects.value = [...projects.value, minted];
  }

  function removeProject(projectId: string): void {
    projects.value = projects.value.filter((project) => project.id !== projectId);
  }

  /** What the software does, in a few words — the `{purpose}` slot's value. */
  function setProjectPurpose(projectId: string, purpose: string): void {
    projects.value = projects.value.map((project) =>
      project.id === projectId ? { ...project, purpose: purpose.trim() } : project,
    );
  }

  /** This product's own update box — one update per line, pasted straight out
   *  of that project's Claude Code session. Leading bullets and numbering are
   *  stripped, because that is how such a list arrives. */
  function setProjectUpdates(projectId: string, updatesText: string): void {
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            updates: updatesText
              .split(/\n+/)
              .map((line) =>
                line
                  .trim()
                  .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
                  .trim(),
              )
              .filter((line) => line.length > 0),
          }
        : project,
    );
  }

  /** The products a take can actually speak about — the ones with updates. */
  const readyProjects = computed(() => projectsWithUpdates(projects.value));

  /** Put the built-in software list back, shipped work and all. The roster is
   *  saved per browser, so a machine that opened the kit before the lists
   *  landed needs a way to pull them in without pasting six of them by hand
   *  (Chad, 2026-08-28). Anything he has typed himself is kept: only products
   *  with an EMPTY box take the built-in list. */
  function loadBuiltInSoftware(): void {
    const byId = new Map(projects.value.map((project) => [project.id, project]));
    projects.value = [
      ...DEMO_PROJECTS.map((seed) => {
        const mine = byId.get(seed.id);
        if (mine === undefined) return { ...seed };
        return {
          ...mine,
          updates: mine.updates.length > 0 ? mine.updates : seed.updates,
        };
      }),
      // Software he added himself is never dropped by a reload of the list.
      ...projects.value.filter(
        (project) => !DEMO_PROJECTS.some((seed) => seed.id === project.id),
      ),
    ];
  }

  // ── Used updates ──────────────────────────────────────────────────────────
  // An update is SPOKEN FOR once it is sitting in a queued take or has already
  // been filmed, so ten videos work through the boxes instead of circling the
  // same three lines (Chad, 2026-08-28). Queue membership is derived, never
  // stored: deleting or rerolling a take hands its updates straight back.
  const filmedUpdates = ref<string[]>(readStoredFilmed());

  watch(
    filmedUpdates,
    (value) =>
      localStorage.setItem(DEMO_FILMED_STORAGE_KEY, JSON.stringify({ filmed: value })),
    { deep: true },
  );

  const queuedUpdates = computed(
    () =>
      new Set(
        scripts.value.flatMap((script) =>
          script.lines
            .map((line) => line.sourceUpdate)
            .filter((update): update is string => update !== null),
        ),
      ),
  );

  const usedUpdates = computed(
    () => new Set([...filmedUpdates.value, ...queuedUpdates.value]),
  );

  /** How a product's box stands: how many lines, and how many still unspoken. */
  function updateTally(projectId: string): { total: number; fresh: number } {
    const project = projects.value.find((row) => row.id === projectId);
    if (project === undefined) return { total: 0, fresh: 0 };
    const used = usedUpdates.value;
    return {
      total: project.updates.length,
      fresh: project.updates.filter((update) => !used.has(update)).length,
    };
  }

  /** Hand every update back — a new week of filming starts fresh. */
  function clearUsedUpdates(): void {
    filmedUpdates.value = [];
  }

  // ── The update bank ───────────────────────────────────────────────────────
  // Top-level ideas (Sales, Leads, Mastermind…), each holding the update lines
  // filed under it. A take spreads its bullets across different ones.
  const updateCategories = ref<UpdateCategory[]>(readStoredCategories());

  watch(
    updateCategories,
    (value) =>
      localStorage.setItem(
        DEMO_SAMPLES_STORAGE_KEY,
        JSON.stringify({ categories: value }),
      ),
    { deep: true },
  );

  /** Every line in the bank, whatever idea it is filed under. */
  const allUpdateSamples = computed(() =>
    flattenUpdateSamples(updateCategories.value),
  );

  // The take's FURNITURE: the handoff into the dev updates and the closing
  // line. Spoken by the routine around the script, never written into it, so
  // the card shows only what Chad actually reads (2026-08-28).
  const framingLines = computed(() => [
    ...categorySamples(updateCategories.value, INTRO_CATEGORY_ID),
    ...categorySamples(updateCategories.value, CONCLUSION_CATEGORY_ID),
  ]);

  function pickIntroLine(): string | null {
    return pickFramingLine(
      updateCategories.value,
      INTRO_CATEGORY_ID,
      rollTakeMetrics(metricRules.value, Math.random),
      Math.random,
    );
  }

  function pickConclusionLine(): string | null {
    return pickFramingLine(
      updateCategories.value,
      CONCLUSION_CATEGORY_ID,
      rollTakeMetrics(metricRules.value, Math.random),
      Math.random,
    );
  }

  function addCategory(label: string): void {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    const id =
      trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      crypto.randomUUID();
    if (updateCategories.value.some((category) => category.id === id)) return;
    updateCategories.value = [...updateCategories.value, { id, label: trimmed, samples: [] }];
  }

  function removeCategory(categoryId: string): void {
    updateCategories.value = updateCategories.value.filter(
      (category) => category.id !== categoryId,
    );
  }

  /** Rewrite one idea's whole list — the paste path. */
  function setCategorySamples(categoryId: string, samplesText: string): void {
    updateCategories.value = updateCategories.value.map((category) =>
      category.id === categoryId
        ? {
            ...category,
            samples: samplesText
              .split(/\n+/)
              .map((sample) => sample.trim())
              .filter((sample) => sample.length > 0),
          }
        : category,
    );
  }

  /** One line at a time — the field-per-line path the screen uses. */
  function mapCategorySamples(
    categoryId: string,
    change: (samples: readonly string[]) => string[],
  ): void {
    updateCategories.value = updateCategories.value.map((category) =>
      category.id === categoryId
        ? { ...category, samples: change(category.samples) }
        : category,
    );
  }

  function addCategorySample(categoryId: string, sample: string): void {
    const trimmed = sample.trim();
    if (trimmed.length === 0) return;
    mapCategorySamples(categoryId, (samples) => [...samples, trimmed]);
  }

  /** Edit a line in place; emptying it removes the row (the field's own ✕ is
   *  the explicit path, but a cleared box must not leave a blank line in the
   *  bank for the writer to speak). */
  function updateCategorySample(
    categoryId: string,
    index: number,
    sample: string,
  ): void {
    const trimmed = sample.trim();
    mapCategorySamples(categoryId, (samples) =>
      trimmed.length === 0
        ? samples.filter((_, row) => row !== index)
        : samples.map((existing, row) => (row === index ? trimmed : existing)),
    );
  }

  function removeCategorySample(categoryId: string, index: number): void {
    mapCategorySamples(categoryId, (samples) =>
      samples.filter((_, row) => row !== index),
    );
  }

  function restoreDefaultSamples(): void {
    updateCategories.value = DEFAULT_UPDATE_CATEGORIES.map((row) => ({ ...row }));
  }

  // ── The rules ─────────────────────────────────────────────────────────────
  // What a number is allowed to be when a take speaks one. Each rule owns a
  // slot an update line can write — `{sales}` rolls inside Sales' range.
  const metricRules = ref<MetricRule[]>(readStoredRules());

  watch(
    metricRules,
    (value) =>
      localStorage.setItem(DEMO_RULES_STORAGE_KEY, JSON.stringify({ rules: value })),
    { deep: true },
  );

  /** The whole rule list as the text the user typed — `leads: 300-1200`, one
   *  per line. An unreadable line is dropped by the parser rather than
   *  guessed at; an empty box restores the built-ins, so a take always has
   *  numbers to roll. */
  const metricRulesText = computed(() => formatMetricRules(metricRules.value));

  /** Lines the last edit could not read. Held so the screen can SAY so — a
   *  rule that silently vanished is the one failure this box cannot afford. */
  const unreadableRuleLines = ref<string[]>([]);

  function setMetricRulesText(text: string): void {
    const { rules, unreadable } = parseMetricRuleLines(text);
    unreadableRuleLines.value = unreadable;
    metricRules.value =
      rules.length > 0 ? rules : DEFAULT_METRIC_RULES.map((rule) => ({ ...rule }));
  }

  function restoreDefaultRules(): void {
    metricRules.value = DEFAULT_METRIC_RULES.map((rule) => ({ ...rule }));
    unreadableRuleLines.value = [];
  }

  // ── Must-haves ────────────────────────────────────────────────────────────
  // "Say this every time" (Chad, 2026-08-28): a STAR on an update sample, and
  // a pin on a product. Stars are held by the sample's own text — the bank is
  // edited as text, so there is no id to hold onto, and a reworded line is a
  // different line that deserves a fresh decision.
  const starredSamples = ref<string[]>(readStoredAlways().samples);
  const alwaysProjectIds = ref<string[]>(readStoredAlways().projectIds);

  watch(
    [starredSamples, alwaysProjectIds],
    () =>
      localStorage.setItem(
        DEMO_ALWAYS_STORAGE_KEY,
        JSON.stringify({
          samples: starredSamples.value,
          projectIds: alwaysProjectIds.value,
        }),
      ),
    { deep: true },
  );

  /** The starred lines, in the order the BANK holds them — a take reads top to
   *  bottom, not in the order the stars were clicked. */
  const orderedStarred = computed(() =>
    allUpdateSamples.value.filter((sample) => starredSamples.value.includes(sample)),
  );

  function isStarred(sample: string): boolean {
    return starredSamples.value.includes(sample);
  }

  function toggleStarredSample(sample: string): void {
    starredSamples.value = starredSamples.value.includes(sample)
      ? starredSamples.value.filter((row) => row !== sample)
      : [...starredSamples.value, sample];
  }

  /** Whether this product must appear in every video. */
  function toggleAlwaysProject(projectId: string): void {
    alwaysProjectIds.value = alwaysProjectIds.value.includes(projectId)
      ? alwaysProjectIds.value.filter((id) => id !== projectId)
      : [...alwaysProjectIds.value, projectId];
  }

  // ── The script library ────────────────────────────────────────────────────
  const scripts = ref<DemoScript[]>(readStoredScripts());
  const activeScriptId = ref<string | null>(
    localStorage.getItem(DEMO_ACTIVE_SCRIPT_STORAGE_KEY),
  );
  const activeScript = computed(
    () => scripts.value.find((script) => script.id === activeScriptId.value) ?? null,
  );

  watch(
    scripts,
    (value) =>
      localStorage.setItem(
        DEMO_SCRIPTS_STORAGE_KEY,
        JSON.stringify({ scripts: value }),
      ),
    { deep: true },
  );
  watch(activeScriptId, (value) => {
    if (value === null) localStorage.removeItem(DEMO_ACTIVE_SCRIPT_STORAGE_KEY);
    else localStorage.setItem(DEMO_ACTIVE_SCRIPT_STORAGE_KEY, value);
  });

  function adoptScript(lines: DemoScriptLine[], title: string): DemoScript {
    const script: DemoScript = {
      id: crypto.randomUUID(),
      title,
      lines,
      status: "pending",
      createdAt: Date.now(),
    };
    scripts.value = [script, ...scripts.value];
    // The new script becomes the active one: writing it is the clearest
    // statement of which take is being looked at.
    activeScriptId.value = script.id;
    void prepareAudio();
    return script;
  }

  /** The title a queue card wears: the software the take actually covers. */
  function titleOf(lines: readonly DemoScriptLine[]): string {
    const named = lines
      .map((line) => projects.value.find((project) => project.id === line.projectId)?.name)
      .filter((name): name is string => name !== undefined);
    return named.length > 0 ? named.join(", ") : "HUD only";
  }

  function writeTakeLines(onlyProjectIds?: readonly string[]): DemoScriptLine[] {
    return writeDemoTake({
      roster: projects.value,
      categories: updateCategories.value,
      rules: metricRules.value,
      random: Math.random,
      onlyProjectIds,
      usedUpdates: usedUpdates.value,
      alwaysProjectIds: alwaysProjectIds.value,
      starredSamples: orderedStarred.value,
    });
  }

  /** One take from named software — "Mintbird, Quizforma, GC". */
  function addScriptFromNames(namesText: string): DemoScript | null {
    const ids = namesText
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => findMentionedProject(name, projects.value)?.id)
      .filter((id): id is string => id !== undefined);
    if (ids.length === 0) return null;
    const lines = writeTakeLines(ids);
    return lines.length === 0 ? null : adoptScript(lines, titleOf(lines));
  }

  /** The one-click take — random software with updates, HUD lines between. */
  function addRandomScript(): DemoScript | null {
    const lines = writeTakeLines();
    return lines.length === 0 ? null : adoptScript(lines, titleOf(lines));
  }

  // ── The queue ─────────────────────────────────────────────────────────────
  // Ten takes written and waiting; the user approves the ones that may be
  // filmed. Only approved takes are pre-recorded and only approved takes play.
  const approvedScripts = computed(() =>
    scripts.value.filter((script) => script.status === "approved"),
  );
  const pendingScripts = computed(() =>
    scripts.value.filter((script) => script.status === "pending"),
  );

  /** Top the queue back up to ten. Called by the Scripts tab's one button and
   *  after a rejection, so there is always a full deck to read through. */
  function fillQueue(target = DEMO_QUEUE_TARGET): void {
    let guard = target * 3; // a tiny roster can repeat; never spin forever
    while (scripts.value.length < target && guard-- > 0) {
      const lines = writeTakeLines();
      if (lines.length === 0) break;
      scripts.value = [
        ...scripts.value,
        {
          id: crypto.randomUUID(),
          title: titleOf(lines),
          lines,
          status: "pending",
          createdAt: Date.now(),
        },
      ];
    }
    void prepareAudio();
  }

  /** Throw the whole queue away and write it again. Scripts written before a
   *  change to the software, samples or rules are stale, and clicking ✕ ten
   *  times to clear them is not a workflow (Chad, 2026-08-28). */
  function rewriteQueue(): void {
    scripts.value = [];
    activeScriptId.value = null;
    nextTakeIndex.value = 0;
    fillQueue();
  }

  function approveScript(scriptId: string): void {
    scripts.value = scripts.value.map((script) =>
      script.id === scriptId ? { ...script, status: "approved" as const } : script,
    );
    void prepareAudio();
  }

  /** Approve the whole queue and record every voice in one pass (Chad,
   *  2026-08-28). One recording run for ten takes rather than ten runs. */
  function approveAll(): void {
    scripts.value = scripts.value.map((script) => ({
      ...script,
      status: "approved" as const,
    }));
    void prepareAudio();
  }

  function unapproveScript(scriptId: string): void {
    scripts.value = scripts.value.map((script) =>
      script.id === scriptId ? { ...script, status: "pending" as const } : script,
    );
  }

  /** Send the whole queue back for a read — the way out of an Approve-all the
   *  user did not mean, without unapproving ten cards one at a time. */
  function unapproveAll(): void {
    scripts.value = scripts.value.map((script) => ({
      ...script,
      status: "pending" as const,
    }));
  }

  /** Throw this take away and write a fresh one in its place — the queue keeps
   *  its depth, so rejecting never leaves the deck short on film day. */
  function rerollScript(scriptId: string): void {
    const lines = writeTakeLines();
    if (lines.length === 0) return;
    scripts.value = scripts.value.map((script) =>
      script.id === scriptId
        ? { ...script, lines, status: "pending" as const, title: titleOf(lines) }
        : script,
    );
    void prepareAudio();
  }

  /** Which approved take the NEXT wake plays. Rotates, so filming ten videos
   *  back to back gives ten different scripts without touching the screen. */
  const nextTakeIndex = ref(0);

  const nextApprovedScript = computed<DemoScript | null>(() => {
    const deck = approvedScripts.value;
    return deck.length === 0
      ? null
      : deck[nextTakeIndex.value % deck.length] ?? null;
  });

  // ── The two halves of a take ──────────────────────────────────────────────
  // On camera the film is a conversation (Chad, 2026-08-28): "What's up
  // Pacino" plays the evening update and STOPS, then he asks "how's our
  // software doing" and the products play. The split is where the film first
  // cuts to the node screen — the same seam the routine already uses.
  function takeLines(script: DemoScript | null, part: TakePart): DemoScriptLine[] {
    if (script === null) return [];
    const firstNode = script.lines.findIndex((line) => line.surface === "nodes");
    // A take with no products at all is one part: the opening IS the video.
    if (firstNode === -1) return part === "opening" ? [...script.lines] : [];
    return part === "opening"
      ? script.lines.slice(0, firstNode)
      : script.lines.slice(firstNode);
  }

  /** Which half the next trigger plays. The wake phrase always starts a take
   *  at the opening; the follow-up question asks for the software half. */
  const nextPart = ref<TakePart>("opening");

  /** Does this spoken command ask for the software half? The daemon hands the
   *  whole question over, so the words decide — anything else is the wake
   *  phrase, which always restarts the take. */
  function isSoftwareRequest(command: string): boolean {
    return /\b(software|dev|development|team|crew|projects?|updates?|building|working on|up to)\b/i.test(
      command,
    );
  }

  /** A take the user asked for BY NAME — the Demo button on a queue card
   *  (Chad, 2026-08-28). It outranks the rotation for one run, so "play this
   *  one" means this one, and is cleared when that run ends. */
  const requestedScriptId = ref<string | null>(null);

  /** What the next run will film: the one asked for, else the rotation's turn,
   *  else whatever is being looked at (so Rehearse works before any approval). */
  const takeToFilm = computed<DemoScript | null>(() => {
    const asked = scripts.value.find((script) => script.id === requestedScriptId.value);
    return asked ?? nextApprovedScript.value ?? activeScript.value;
  });

  /** Where a take stands, in the words the screen shows: it needs reading,
   *  its voice is being recorded, or it is ready to film.
   *
   *  The audio bank is a plain Map — deliberately, it holds Blobs and nothing
   *  should make those reactive — so this reads `recordedTick` to know when to
   *  look again. Without that the cards never turned green: the audio landed
   *  and no screen was told (Chad, 2026-08-28). */
  function scriptStage(script: DemoScript): "unread" | "recording" | "recorded" {
    void recordedTick.value;
    if (script.status !== "approved") return "unread";
    const recorded = script.lines.every(
      (line) => bank.durationOf(line.text) !== null,
    );
    return recorded ? "recorded" : "recording";
  }

  /** A take just finished filming: its updates are spent for good, and the
   *  queue moves to the next approved script. */
  function advanceQueue(): void {
    const filmed = nextApprovedScript.value;
    if (filmed !== null) {
      const spoken = filmed.lines
        .map((line) => line.sourceUpdate)
        .filter((update): update is string => update !== null);
      filmedUpdates.value = [...new Set([...filmedUpdates.value, ...spoken])];
    }
    if (approvedScripts.value.length > 0) nextTakeIndex.value += 1;
  }

  function updateLine(scriptId: string, index: number, text: string): void {
    const script = scripts.value.find((row) => row.id === scriptId);
    if (script === undefined || script.lines[index] === undefined) return;
    script.lines[index] = relinkEditedLine(
      text,
      projects.value,
      script.lines[index]!.sourceUpdate,
    );
    if (scriptId === activeScriptId.value) void prepareAudio();
  }

  function removeScript(scriptId: string): void {
    scripts.value = scripts.value.filter((script) => script.id !== scriptId);
    if (activeScriptId.value === scriptId) activeScriptId.value = null;
  }

  function setActiveScript(scriptId: string): void {
    if (!scripts.value.some((script) => script.id === scriptId)) return;
    activeScriptId.value = scriptId;
    void prepareAudio();
  }

  // ── The recording bank ────────────────────────────────────────────────────
  // 'failed' = the daemon could not record every line (down, or no voice
  // model). The screen says so instead of letting a take open onto silence.
  const readiness = ref<"idle" | "preparing" | "ready" | "failed">("idle");

  // SCRIPTS FIRST, greetings after (Chad, 2026-08-28). The greeting pool is 16
  // lines and only one is ever used per take, so recording it first left the
  // Play button dead for a minute on a screen full of scripts. The take being
  // looked at leads, then the approved queue, then the greetings.
  function linesToRecord(): string[] {
    const looking = activeScript.value?.lines.map((line) => line.text) ?? [];
    const approved = approvedScripts.value.flatMap((script) =>
      script.lines.map((line) => line.text),
    );
    // The greeting pool is 16 lines and only matters to the ARMED routine, so
    // it waits until a take is approved. Filling the queue therefore records
    // nothing, and approving one records THAT take immediately rather than
    // sitting behind sixteen hellos nobody has asked for yet.
    const spokenAround =
      approved.length > 0 ? [...allDemoGreetings(), ...framingLines.value] : [];
    return [...new Set([...looking, ...approved, ...spokenAround])];
  }

  /** How far the recording has got — shown on screen, so a slow first run
   *  reads as progress rather than a dead button. */
  const prepareProgress = ref<{ done: number; total: number }>({ done: 0, total: 0 });

  /** Bumped whenever a line lands in the audio bank. The bank itself is a
   *  plain Map of Blobs; this is the signal that tells the screens to re-read
   *  it — runtimes, per-line seconds and the ready/waiting split all hang off
   *  it. */
  const recordedTick = ref(0);

  // ONE recording pass at a time, and every request gets a pass of its own.
  // Two loops at once do not go faster — they queue on the same synth and
  // halve the rate — but a "flag the run as stale" scheme drops any request
  // that lands after the last pass ended and before its handle cleared, which
  // is exactly when approving a take asks for one (Chad, 2026-08-28: the
  // approved take recorded nothing). Chaining onto the tail cannot lose one:
  // a pass whose lines are all recorded already costs nothing.
  let recordingChain: Promise<void> = Promise.resolve();

  async function recordOnce(): Promise<void> {
    const texts = linesToRecord();
    if (bank.isReady(texts)) {
      readiness.value = "ready";
      return;
    }
    readiness.value = "preparing";
    prepareProgress.value = { done: 0, total: texts.length };
    const complete = await bank.prepare(texts, (done, total) => {
      prepareProgress.value = { done, total };
      recordedTick.value += 1;
    });
    readiness.value = complete ? "ready" : "failed";
  }

  function prepareAudio(): Promise<void> {
    recordingChain = recordingChain.then(recordOnce, recordOnce);
    return recordingChain;
  }

  /** A take's length: every line plus the beats between, from REAL audio.
   *  Null until it is recorded. */
  function scriptRuntimeSeconds(script: DemoScript | null): number | null {
    void recordedTick.value;
    // A take's own length is known as soon as ITS lines are recorded — waiting
    // for the whole bank would hide the number through a ten-take batch.
    if (script === null) return null;
    let total = 0;
    for (const line of script.lines) {
      const seconds = bank.durationOf(line.text);
      if (seconds === null) return null;
      total += seconds + DEMO_LINE_GAP_SECONDS;
    }
    return total;
  }

  const activeScriptRuntimeSeconds = computed(() =>
    scriptRuntimeSeconds(activeScript.value),
  );

  // ── Armed state ───────────────────────────────────────────────────────────
  // Armed = the wake word runs the ROUTINE instead of a real conversation, and
  // every line is recorded up front. The truth lives in the cross-window flag
  // (demo-armed-flag) with its own expiry — a wake can land in the dock's
  // webview, whose Pinia is not this one; this ref is only this window's
  // reactive mirror of it.
  const isArmed = ref(readDemoArmedFlag());
  /** The look the user actually chose, put back when filming ends — a random
   *  take must not overwrite their saved shape and colour. */
  let rememberedLook: { shape: string; colour: string } | null = null;

  function arm(): void {
    if (isArmed.value) return;
    isArmed.value = true;
    writeDemoArmedFlag(true);
    rememberedLook = { shape: ui.displayShape, colour: ui.displayColour };
    void prepareAudio();
  }

  function disarm(): void {
    if (!isArmed.value) return;
    isArmed.value = false;
    writeDemoArmedFlag(false);
    bank.stop();
    isRoutineRunning.value = false;
    routineNodes.value = null;
    routineMessages.value = [];
    if (rememberedLook !== null) {
      ui.setDisplayShape(rememberedLook.shape);
      ui.setDisplayColour(rememberedLook.colour);
      rememberedLook = null;
    }
  }

  function toggleArmed(): void {
    if (isArmed.value) disarm();
    else arm();
  }

  /** Armed RIGHT NOW — the wake-time reading. Re-checks the cross-window flag
   *  so a window left open past the flag's expiry falls back to live wakes in
   *  step with every other window, instead of keeping a stale mirror. */
  function isArmedNow(): boolean {
    if (isArmed.value && !readDemoArmedFlag()) disarm();
    return isArmed.value;
  }

  /** A different look every take: shape and colour both re-rolled away from
   *  what is currently on. 9 colours × 14 shapes — the film never repeats. */
  function randomizeLook(): void {
    const colours = DISPLAY_COLOURS.filter((colour) => colour.id !== ui.displayColour);
    const shapes = DISPLAY_SHAPES.filter((shape) => shape.id !== ui.displayShape);
    ui.setDisplayColour(colours[Math.floor(Math.random() * colours.length)]!.id);
    ui.setDisplayShape(shapes[Math.floor(Math.random() * shapes.length)]!.id);
  }

  // ── The routine's scene ───────────────────────────────────────────────────
  // The node screen renders THESE while a routine drives (null = not driving).
  // The sequencer mutates them line by line; NodesView only watches.
  const isRoutineRunning = ref(false);
  /** A pre-recorded line is playing right now. The Display reads this to burn
   *  and mouth like it does for a live reply — the take makes no session of
   *  its own, so without it the orb sat still through a whole video. */
  const isSpeakingLine = ref(false);
  const routineNodes = ref<SceneNode[] | null>(null);
  const routineMessages = ref<SceneMessage[]>([]);

  // The ring-the-bell counter (the create-workspace precedent): a wake lands
  // in whichever component holds the daemon link, but the sequencer lives in
  // the shell — the wake bumps this, the shell watches it.
  const routineRequestCount = ref(0);
  /** Run the routine. Naming a script films THAT one; naming none films the
   *  queue's turn, which is what a wake word does. A part may be forced —
   *  the ▶ Demo button plays a whole take rather than half of one. */
  function requestRoutine(scriptId?: string, part: TakePart | "whole" = "whole"): void {
    requestedScriptId.value = scriptId ?? null;
    requestedPart.value = part;
    routineRequestCount.value += 1;
  }

  /** What the next run plays: one half, or the take end to end. */
  const requestedPart = ref<TakePart | "whole">("whole");

  /** A spoken trigger arrived. The wake phrase starts a take at its opening;
   *  a question about the software plays the half that shows the products —
   *  and only if an opening has already been filmed, so an out-of-order
   *  question does not open a video halfway through. */
  function requestSpokenRoutine(command: string): void {
    const wantsSoftware = isSoftwareRequest(command) && nextPart.value === "software";
    requestedScriptId.value = null;
    requestedPart.value = wantsSoftware ? "software" : "opening";
    routineRequestCount.value += 1;
  }

  /** Called by the routine once a half has played, so the next trigger knows
   *  where it is: after an opening comes the software, and after the software
   *  the queue moves on and the next wake starts a fresh take. */
  function finishedPart(part: TakePart): void {
    nextPart.value = part === "opening" ? "software" : "opening";
  }

  function resetRoutineScene(): void {
    routineNodes.value = demoFleetNodes(projects.value).map((node) => ({
      ...node,
      status: "idle" as const,
    }));
    routineMessages.value = [];
  }

  /** Hand the node screen back to the real fleet. Disarming does this too;
   *  this exists for an UNARMED rehearsal, whose take must not leave the
   *  scripted fleet parked over real data with no way back. */
  function clearRoutineScene(): void {
    routineNodes.value = null;
    routineMessages.value = [];
  }

  /** Light one project's dot and fire an arc from the core to it. */
  function lightProject(projectId: string, sequence: number): void {
    if (routineNodes.value === null) return;
    const nodeId = demoNodeId(projectId);
    routineNodes.value = routineNodes.value.map((node) =>
      node.id === nodeId ? { ...node, status: "building" as const } : node,
    );
    routineMessages.value = [
      ...routineMessages.value,
      {
        id: `demo-arc-${sequence}`,
        fromId: null,
        toId: nodeId,
        direction: "ask",
        sentAt: Date.now(),
      },
    ];
  }

  /** The bullet finished — its dot settles green, and a reply arc comes home. */
  function settleProject(projectId: string, sequence: number): void {
    if (routineNodes.value === null) return;
    const nodeId = demoNodeId(projectId);
    routineNodes.value = routineNodes.value.map((node) =>
      node.id === nodeId ? { ...node, status: "done" as const } : node,
    );
    routineMessages.value = [
      ...routineMessages.value,
      {
        id: `demo-arc-${sequence}-reply`,
        fromId: nodeId,
        toId: null,
        direction: "reply",
        sentAt: Date.now(),
      },
    ];
  }

  return {
    projects,
    addProject,
    removeProject,
    setProjectPurpose,
    setProjectUpdates,
    readyProjects,
    loadBuiltInSoftware,
    updateCategories,
    allUpdateSamples,
    pickIntroLine,
    pickConclusionLine,
    addCategory,
    removeCategory,
    setCategorySamples,
    addCategorySample,
    updateCategorySample,
    removeCategorySample,
    restoreDefaultSamples,
    metricRules,
    metricRulesText,
    unreadableRuleLines,
    setMetricRulesText,
    restoreDefaultRules,
    starredSamples,
    orderedStarred,
    isStarred,
    toggleStarredSample,
    alwaysProjectIds,
    toggleAlwaysProject,
    usedUpdates,
    updateTally,
    clearUsedUpdates,
    scripts,
    activeScriptId,
    activeScript,
    approvedScripts,
    pendingScripts,
    nextApprovedScript,
    takeToFilm,
    requestedScriptId,
    requestedPart,
    nextPart,
    takeLines,
    isSoftwareRequest,
    requestSpokenRoutine,
    finishedPart,
    scriptStage,
    fillQueue,
    rewriteQueue,
    approveScript,
    approveAll,
    unapproveScript,
    unapproveAll,
    rerollScript,
    advanceQueue,
    scriptRuntimeSeconds,
    addScriptFromNames,
    addRandomScript,
    updateLine,
    removeScript,
    setActiveScript,
    readiness,
    prepareProgress,
    prepareAudio,
    activeScriptRuntimeSeconds,
    lineDurationSeconds: (text: string) => {
      void recordedTick.value;
      return bank.durationOf(text);
    },
    isSpeakingLine,
    playRecordedLine: async (text: string) => {
      isSpeakingLine.value = true;
      try {
        await bank.play(text);
      } finally {
        isSpeakingLine.value = false;
        // A play-on-demand records the line too — the screens must see it.
        recordedTick.value += 1;
      }
    },
    stopAudio: () => bank.stop(),
    isArmed,
    arm,
    disarm,
    toggleArmed,
    isArmedNow,
    randomizeLook,
    isRoutineRunning,
    routineNodes,
    routineMessages,
    routineRequestCount,
    requestRoutine,
    resetRoutineScene,
    clearRoutineScene,
    lightProject,
    settleProject,
  };
});
