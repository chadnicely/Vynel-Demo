import type { SceneNode } from "../utils/constellation-scene.js";
import { DEMO_UPDATES_SEED } from "./demo-updates-seed.js";

// The demo fleet — Chad's REAL products, so a filmed script about "Mintbird"
// points at a dot that exists (the placeholder fleet read as a mock the moment
// a viewer knew the names). One roster serves three consumers: the Nodes
// screen's Demo switch, the script writer's mention detection, and the
// routine's lit-up sequence — split lists would drift and a script would name
// a project the screen cannot light.
//
// The roster is EDITABLE (demo-store persists it); this module holds the seed
// and the pure functions every consumer shares. Each function takes the roster
// it should read — the store owns which roster is current.

export interface DemoProject {
  /** Stable slug — also the node id's tail (`demo:<id>`). */
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  /** Every spelling a script may use for this project, lowercase. Includes
   *  the name itself — one list to search, not a name plus a list. */
  readonly aliases: readonly string[];
  /** What the software DOES, in a few words — "checkout pages that convert".
   *  An update sample carrying `{purpose}` speaks it, so one sentence pool
   *  says something specific about every product. Empty = samples that need
   *  it are skipped for this one. */
  readonly purpose: string;
  /** This product's OWN update box — the real updates Claude hands Chad in
   *  that project's session, pasted raw, one per line (2026-08-28). These are
   *  spoken as written and are the ONLY lines that light a node: when the take
   *  reaches one, the film cuts to the node screen with this dot lit. */
  readonly updates: readonly string[];
}

/** The built-in roster — the SEED for the editable one the store persists.
 *  Each product arrives carrying its real shipped work (demo-updates-seed),
 *  so the film kit can write a true take the moment it is opened. */
export const DEMO_PROJECTS: readonly DemoProject[] = withSeededUpdates([
  {
    id: "mintbird",
    name: "Mintbird",
    initials: "MB",
    aliases: ["mintbird", "mint bird"],
    purpose: "",
    updates: [],
  },
  {
    id: "quizforma",
    name: "Quizforma",
    initials: "QF",
    aliases: ["quizforma", "quiz forma", "quizform"],
    purpose: "",
    updates: [],
  },
  {
    id: "global-control",
    name: "Global Control",
    initials: "GC",
    aliases: ["global control", "gc"],
    purpose: "",
    updates: [],
  },
  {
    id: "letterman",
    name: "Letterman",
    initials: "LM",
    aliases: ["letterman", "letter man"],
    purpose: "",
    updates: [],
  },
  {
    id: "course-sprout",
    name: "Course Sprout",
    initials: "CS",
    aliases: ["course sprout", "coursesprout"],
    purpose: "",
    updates: [],
  },
  {
    id: "video-geyser",
    name: "VideoGeyser",
    initials: "VG",
    aliases: ["videogeyser", "video geyser", "video platform"],
    purpose: "",
    updates: [],
  },
  {
    id: "nicely-community",
    name: "Nicely Community",
    initials: "NC",
    aliases: ["nicely community", "nicely"],
    purpose: "",
    updates: [],
  },
  {
    id: "page-sprout",
    name: "Page Sprout",
    initials: "PS",
    aliases: ["page sprout", "pagesprout"],
    purpose: "",
    updates: [],
  },
  {
    id: "juicypops",
    name: "JuicyPops",
    initials: "JP",
    aliases: ["juicypops", "juicy pops"],
    purpose: "",
    updates: [],
  },
  {
    id: "calentri",
    name: "Calentri",
    initials: "CA",
    aliases: ["calentri"],
    purpose: "",
    updates: [],
  },
]);

/** Hand each product the shipped work recorded for it. Kept as a function
 *  rather than inlined in the roster so the names and the updates stay two
 *  separate things to read. */
function withSeededUpdates(
  roster: readonly DemoProject[],
): readonly DemoProject[] {
  return roster.map((project) => ({
    ...project,
    updates: DEMO_UPDATES_SEED[project.id] ?? project.updates,
  }));
}

export function demoNodeId(projectId: string): string {
  return `demo:${projectId}`;
}

export function findDemoProject(
  projectId: string,
  roster: readonly DemoProject[],
): DemoProject | null {
  return roster.find((project) => project.id === projectId) ?? null;
}

/** Mint a roster entry for software typed on the screen: slug from the name,
 *  initials from its words, the name itself as the one alias. */
export function makeDemoProject(name: string): DemoProject {
  const words = name.trim().split(/\s+/);
  return {
    id:
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || crypto.randomUUID(),
    name: name.trim(),
    initials: (words.length > 1
      ? words[0]![0]! + words[1]![0]!
      : name.trim().slice(0, 2)
    ).toUpperCase(),
    aliases: [name.trim().toLowerCase()],
    purpose: "",
    updates: [],
  };
}

/** The first roster project a line of script mentions, or null — one project
 *  per line is the routine's grammar (each bullet lights one dot). Aliases are
 *  matched on word boundaries so "GC" never fires inside another word. */
export function findMentionedProject(
  line: string,
  roster: readonly DemoProject[],
): DemoProject | null {
  const spoken = line.toLowerCase();
  for (const project of roster) {
    const mentioned = project.aliases.some((alias) =>
      new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${alias.replace(/ /g, "\\s+")}(?:[^\\p{L}\\p{N}]|$)`,
        "u",
      ).test(spoken),
    );
    if (mentioned) return project;
  }
  return null;
}

/** The resting fleet — every roster project as a dot, statuses mixed the way a
 *  busy studio actually looks. The routine restates these live; this is what
 *  the screen shows before and between takes (and behind the Demo switch). */
export function demoFleetNodes(roster: readonly DemoProject[]): SceneNode[] {
  const status = (index: number): SceneNode["status"] =>
    (["building", "waiting", "done", "idle"] as const)[index % 4]!;
  return [
    {
      id: "demo:voice",
      name: "Voice",
      initials: "VO",
      status: "idle",
      role: "moon",
    },
    ...roster.map((project, index) => ({
      id: demoNodeId(project.id),
      name: project.name,
      initials: project.initials,
      status: status(index),
    })),
  ];
}
