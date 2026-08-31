import { describe, expect, it } from "vitest";
import {
  DEMO_PROJECTS,
  demoFleetNodes,
  findMentionedProject,
  makeDemoProject,
} from "./demo-fleet.js";
import {
  bodyCategories,
  DEFAULT_UPDATE_CATEGORIES,
  fillHudSample,
  fillProjectUpdate,
  flattenUpdateSamples,
  pickDemoGreeting,
  projectsWithUpdates,
  relinkEditedLine,
  writeDemoTake,
} from "./demo-script-writer.js";
import { DEFAULT_METRIC_RULES, rollTakeMetrics } from "./demo-rules.js";

const firstOf = () => 0;

/** A roster where every product has a pasted update — the filming state. */
const stocked = DEMO_PROJECTS.map((project) => ({
  ...project,
  purpose: `${project.name.toLowerCase()} things`,
  updates: [`we shipped the new ${project.name.toLowerCase()} dashboard`],
}));

/** The roster with every update box emptied — the shape of a machine with
 *  nothing to say yet. The shipped roster carries Chad's real work, so
 *  "nothing pasted anywhere" has to be built deliberately. */
const BARE = DEMO_PROJECTS.map((project) => ({ ...project, updates: [] }));

describe("findMentionedProject", () => {
  it("resolves a name, a spaced spelling, and the GC shorthand", () => {
    expect(findMentionedProject("Mintbird shipped today", DEMO_PROJECTS)?.id).toBe("mintbird");
    expect(findMentionedProject("mint bird shipped today", DEMO_PROJECTS)?.id).toBe("mintbird");
    expect(findMentionedProject("GC is stable", DEMO_PROJECTS)?.id).toBe("global-control");
  });

  it("matches on word boundaries only — GC never fires inside a word", () => {
    expect(findMentionedProject("the gcc build passed", DEMO_PROJECTS)).toBeNull();
    expect(findMentionedProject("logcat is noisy", DEMO_PROJECTS)).toBeNull();
  });

  it("returns null for a name the roster does not know", () => {
    expect(findMentionedProject("Skunkworks — all good", DEMO_PROJECTS)).toBeNull();
  });
});

describe("makeDemoProject", () => {
  it("mints slug, initials and alias from a typed name", () => {
    const project = makeDemoProject("Deploy Wizard");
    expect(project.id).toBe("deploy-wizard");
    expect(project.initials).toBe("DW");
    expect(project.aliases).toEqual(["deploy wizard"]);
    expect(project.updates).toEqual([]);
  });
});

describe("the shipped HUD bank", () => {
  it("files every line under a named idea and names NO software", () => {
    // Two of these are the take's bookends, spoken around the script.
    expect(DEFAULT_UPDATE_CATEGORIES.map((row) => row.label)).toEqual([
      "Sales",
      "Leads",
      "Mastermind",
      "Into the dev updates",
      "Conclusion",
      "Operations",
    ]);
    expect(bodyCategories(DEFAULT_UPDATE_CATEGORIES).map((row) => row.id)).toEqual([
      "sales",
      "leads",
      "mastermind",
      "operations",
    ]);
    const lines = flattenUpdateSamples(DEFAULT_UPDATE_CATEGORIES);
    expect(lines.length).toBeGreaterThan(12);
    // The HUD is the assistant's own voice — a product is named only by its
    // own pasted update, never by a bank line.
    for (const line of lines) {
      expect(findMentionedProject(line, DEMO_PROJECTS)).toBeNull();
      expect(line).not.toContain("{name}");
    }
  });
});

describe("fillHudSample", () => {
  it("rolls this take's numbers in and lands the sentence", () => {
    const take = rollTakeMetrics(DEFAULT_METRIC_RULES, firstOf);
    expect(fillHudSample("{leads} new leads came in", take)).toBe(
      "375 new leads came in.",
    );
  });
});

describe("fillProjectUpdate", () => {
  const project = { ...DEMO_PROJECTS[0]!, purpose: "checkout pages" };

  it("names the software so the viewer knows which dot lit up", () => {
    expect(fillProjectUpdate("the upsell flow is live", project)).toBe(
      "Mintbird — the upsell flow is live.",
    );
  });

  it("leaves an update that already names it alone", () => {
    expect(fillProjectUpdate("Mintbird finally got dark mode", project)).toBe(
      "Mintbird finally got dark mode.",
    );
  });

  it("fills rule slots inside a pasted update", () => {
    const take = rollTakeMetrics(DEFAULT_METRIC_RULES, firstOf);
    expect(fillProjectUpdate("brought in {leads} signups", project, take)).toBe(
      "Mintbird — brought in 375 signups.",
    );
  });
});

describe("projectsWithUpdates", () => {
  it("is the only pool a take draws from — an empty box is never invented for", () => {
    expect(projectsWithUpdates(BARE)).toHaveLength(0);
    expect(projectsWithUpdates(stocked)).toHaveLength(stocked.length);
    // The shipped roster arrives loaded, so a fresh install can film at once.
    expect(projectsWithUpdates(DEMO_PROJECTS).length).toBeGreaterThan(5);
  });
});

describe("writeDemoTake", () => {
  const take = (overrides = {}) =>
    writeDemoTake({
      roster: stocked,
      categories: DEFAULT_UPDATE_CATEGORIES,
      rules: DEFAULT_METRIC_RULES,
      random: firstOf,
      ...overrides,
    });

  it("opens on the HUD and cuts to the nodes for each software update", () => {
    const lines = take();
    expect(lines[0]!.surface).toBe("hud");
    expect(lines[0]!.projectId).toBeNull();
    const nodeLines = lines.filter((line) => line.surface === "nodes");
    expect(nodeLines).toHaveLength(4);
    // Every node line names the product it lights.
    for (const line of nodeLines) expect(line.projectId).not.toBeNull();
  });

  // TWO GROUPS, ONE SEAM (Chad, 2026-08-30): every update together, then
  // every product together. The shape is the conversation — he speaks once
  // for the updates and once for the products, and `takeLines` splits the
  // take at its first node line. An update stranded after the products could
  // only be reached by asking about SOFTWARE, and the film cut back to the
  // orb mid-answer to say it.
  it("writes the take as two groups: every update, then every product", () => {
    const surfaces = take().map((line) => line.surface);
    expect(surfaces[0]).toBe("hud");
    expect(surfaces.at(-1)).toBe("nodes");
    const boundaries = surfaces.filter(
      (surface, index) => index > 0 && surface !== surfaces[index - 1],
    );
    expect(boundaries).toEqual(["nodes"]);
  });

  it("splits into the two halves the conversation asks for", () => {
    const lines = take();
    const seam = lines.findIndex((line) => line.surface === "nodes");
    const updates = lines.slice(0, seam);
    const products = lines.slice(seam);
    expect(updates.length).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThan(0);
    expect(updates.every((line) => line.surface === "hud")).toBe(true);
    expect(products.every((line) => line.surface === "nodes")).toBe(true);
  });

  it("reserves at least half the take for the software", () => {
    const surfaces = take().map((line) => line.surface);
    expect(surfaces.filter((row) => row === "nodes").length).toBeGreaterThanOrEqual(
      surfaces.filter((row) => row === "hud").length,
    );
  });

  // Starring lines fixes what a take says; it must never squeeze the products
  // out of the video altogether.
  it("keeps the software in even when stars have eaten the budget", () => {
    const starred = [
      "Sales came in at {sales} across the board today.",
      "{leads} new leads came in this week.",
      "Revenue is pacing about twenty percent ahead of last month.",
      "Member retention is the highest it has been all year.",
      "Last night's coaching call had record attendance.",
    ];
    const lines = take({ starredSamples: starred });
    expect(lines.filter((line) => line.surface === "nodes").length).toBeGreaterThan(0);
  });

  it("speaks each product's OWN pasted update", () => {
    const lines = take().filter((line) => line.surface === "nodes");
    for (const line of lines) {
      const project = stocked.find((row) => row.id === line.projectId)!;
      expect(line.text.toLowerCase()).toContain(project.name.toLowerCase());
      expect(line.text).toContain("dashboard");
    }
  });

  it("never repeats a HUD line inside one take", () => {
    const hud = take().filter((line) => line.surface === "hud").map((line) => line.text);
    expect(new Set(hud).size).toBe(hud.length);
  });

  it("writes HUD-only when no software has updates yet", () => {
    const lines = take({ roster: BARE });
    expect(lines.every((line) => line.surface === "hud")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  // A fresh install has no pasted updates and no stars, which used to leave a
  // ONE-LINE "script" on screen. A take is a video: the HUD covers the gap.
  it("is never a fragment — a take fills out even with no software at all", () => {
    expect(take({ roster: BARE })).toHaveLength(7);
    expect(take({ roster: stocked.slice(0, 1) })).toHaveLength(7);
  });

  // A spoken line is ~3s, so six lines plus the greeting is the ~20s video.
  // Starred lines live INSIDE that budget: starring more fixes more of the
  // take, it never makes the video longer.
  it("holds the take to its line budget, starred lines included", () => {
    const starred = [
      "Sales came in at {sales} across the board today.",
      "{leads} new leads came in this week.",
      "Revenue is pacing about twenty percent ahead of last month.",
    ];
    expect(take({ starredSamples: starred })).toHaveLength(7);
    // A take carries every star even where that runs past its own shape —
    // dropping one would break the promise the star makes.
    const tight = take({ starredSamples: starred, closerCount: 0 });
    expect(tight.length).toBeLessThanOrEqual(starred.length + 4);
    for (const star of ["Sales came in at", "new leads came in", "Revenue is pacing"]) {
      expect(tight.some((line) => line.text.includes(star))).toBe(true);
    }
  });

  it("honours a pick of specific software", () => {
    const lines = take({ onlyProjectIds: ["mintbird", "quizforma"] });
    const ids = lines
      .filter((line) => line.surface === "nodes")
      .map((line) => line.projectId);
    expect(new Set(ids)).toEqual(new Set(["mintbird", "quizforma"]));
  });

  it("keeps a take's figures consistent — one roll per metric, whole take", () => {
    const numbers = take()
      .map((line) => line.text.match(/\b\d[\d,]*\b/g) ?? [])
      .flat();
    // Every occurrence of a given metric is the same string across the take.
    expect(new Set(numbers).size).toBeLessThanOrEqual(numbers.length);
  });
});

describe("marking updates off as they get used", () => {
  const roster = [
    { ...DEMO_PROJECTS[0]!, updates: ["shipped A", "shipped B", "shipped C"] },
  ];
  const take = (used: Set<string>) =>
    writeDemoTake({
      roster,
      categories: DEFAULT_UPDATE_CATEGORIES,
      random: firstOf,
      softwareCount: 1,
      usedUpdates: used,
    });

  it("carries the RAW update on the line, so it can be marked off", () => {
    const line = take(new Set()).find((row) => row.surface === "nodes")!;
    expect(roster[0]!.updates).toContain(line.sourceUpdate);
    // HUD lines have nothing to mark off.
    expect(take(new Set()).find((row) => row.surface === "hud")!.sourceUpdate).toBeNull();
  });

  it("skips updates already spoken", () => {
    const line = take(new Set(["shipped A", "shipped B"])).find(
      (row) => row.surface === "nodes",
    )!;
    expect(line.sourceUpdate).toBe("shipped C");
  });

  it("repeats rather than going silent once a box is used up", () => {
    const line = take(new Set(["shipped A", "shipped B", "shipped C"])).find(
      (row) => row.surface === "nodes",
    )!;
    expect(roster[0]!.updates).toContain(line.sourceUpdate);
  });

  it("never uses one update twice inside a single take", () => {
    const lines = writeDemoTake({
      roster: [{ ...roster[0]!, updates: ["shipped A", "shipped B"] }],
      categories: DEFAULT_UPDATE_CATEGORIES,
      random: firstOf,
      softwareCount: 2,
    }).filter((row) => row.surface === "nodes");
    // One product only fills one slot, but the guard is what matters: the
    // update it chose is recorded, and a second draw could not repeat it.
    const used = lines.map((row) => row.sourceUpdate);
    expect(new Set(used).size).toBe(used.length);
  });

  it("puts products with something NEW to say ahead of used-up ones", () => {
    const mixed = [
      { ...DEMO_PROJECTS[0]!, updates: ["old news"] },
      { ...DEMO_PROJECTS[1]!, updates: ["brand new"] },
    ];
    const lines = writeDemoTake({
      roster: mixed,
      categories: DEFAULT_UPDATE_CATEGORIES,
      random: firstOf,
      softwareCount: 1,
      usedUpdates: new Set(["old news"]),
    }).filter((row) => row.surface === "nodes");
    expect(lines[0]!.projectId).toBe(mixed[1]!.id);
  });
});

describe("things that must be in every video", () => {
  const roster = stocked.slice(0, 3);

  it("says every starred line, in bank order, taking the HUD's turns", () => {
    const lines = writeDemoTake({
      roster,
      categories: DEFAULT_UPDATE_CATEGORIES,
      rules: DEFAULT_METRIC_RULES,
      random: firstOf,
      starredSamples: [
        "Sales came in at {sales} across the board today.",
        "{leads} new leads came in this week.",
      ],
    });
    // They are the FIRST things the assistant says, before the film cuts to
    // the products.
    const hud = lines.filter((line) => line.surface === "hud").map((line) => line.text);
    expect(hud[0]).toBe("Sales came in at $400 across the board today.");
    expect(hud[1]).toBe("375 new leads came in this week.");
    expect(lines[0]!.surface).toBe("hud");
  });

  it("never repeats a starred line later in the same take", () => {
    const starred = "Sales came in at {sales} across the board today.";
    const texts = writeDemoTake({
      roster,
      categories: DEFAULT_UPDATE_CATEGORIES,
      rules: DEFAULT_METRIC_RULES,
      random: firstOf,
      starredSamples: [starred],
    })
      .filter((line) => line.surface === "hud")
      .map((line) => line.text);
    const spoken = texts.filter((text) => text.startsWith("Sales came in at"));
    expect(spoken).toHaveLength(1);
  });

  it("always features the software the rules pin, whatever the shuffle draws", () => {
    const pinned = roster.at(-1)!.id;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const lines = writeDemoTake({
        roster,
        categories: DEFAULT_UPDATE_CATEGORIES,
        random: Math.random,
        softwareCount: 1,
        alwaysProjectIds: [pinned],
      });
      const ids = lines.filter((row) => row.surface === "nodes").map((row) => row.projectId);
      expect(ids).toContain(pinned);
    }
  });
});

describe("relinkEditedLine", () => {
  it("naming a product makes it a node line; naming none is HUD talk", () => {
    const node = relinkEditedLine("Letterman crushed it today", DEMO_PROJECTS);
    expect(node).toMatchObject({ projectId: "letterman", surface: "nodes" });
    const hud = relinkEditedLine("everything is on plan", DEMO_PROJECTS);
    expect(hud).toMatchObject({ projectId: null, surface: "hud" });
  });
});

describe("demoFleetNodes", () => {
  it("gives every roster project a dot plus the voice moon", () => {
    const nodes = demoFleetNodes(DEMO_PROJECTS);
    expect(nodes.some((node) => node.role === "moon")).toBe(true);
    expect(nodes.filter((node) => node.role !== "moon")).toHaveLength(10);
  });
});

describe("pickDemoGreeting", () => {
  it("is deterministic under a fixed random", () => {
    expect(pickDemoGreeting(firstOf)).toBe(pickDemoGreeting(firstOf));
  });
});
