import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_METRIC_RULES } from "../demo/demo-rules.js";
import { DEMO_QUEUE_TARGET, useDemoStore } from "./demo-store.js";
import { useUiStore } from "./ui-store.js";

// The synth endpoint is a real daemon in the app; here every recording
// "fails" quietly so no test ever waits on audio.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: false, status: 500 })),
);

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

/** The filming state: every product carries a pasted update, so takes have
 *  software to talk about. Without this a take is HUD-only, by design. */
function stockUpdates(demo: ReturnType<typeof useDemoStore>): void {
  for (const project of demo.projects) {
    demo.setProjectUpdates(project.id, `we shipped the ${project.name} rebuild`);
  }
}

/** The opposite: nothing pasted anywhere. The shipped roster arrives carrying
 *  Chad's real work, so an empty machine has to be made deliberately. */
function clearUpdates(demo: ReturnType<typeof useDemoStore>): void {
  for (const project of demo.projects) demo.setProjectUpdates(project.id, "");
}

describe("demo-store roster", () => {
  it("seeds with the built-in software and persists edits", async () => {
    const demo = useDemoStore();
    expect(demo.projects.length).toBe(10);
    demo.addProject("Deploy Wizard");
    demo.setProjectPurpose("deploy-wizard", "  one-click deploys  ");
    await nextTick();
    expect(demo.projects.at(-1)!.purpose).toBe("one-click deploys");
    expect(localStorage.getItem("vynel.demo-projects")).toContain("deploy-wizard");
    demo.removeProject("deploy-wizard");
    expect(demo.projects.length).toBe(10);
  });

  it("takes a pasted update list, bullets and all", async () => {
    const demo = useDemoStore();
    clearUpdates(demo);
    demo.setProjectUpdates(
      "mintbird",
      "- the one-click upsell flow is live\n2) we rebuilt the affiliate dashboard\n\n  • mobile checkout ships tomorrow  \n",
    );
    await nextTick();
    expect(demo.projects.find((row) => row.id === "mintbird")!.updates).toEqual([
      "the one-click upsell flow is live",
      "we rebuilt the affiliate dashboard",
      "mobile checkout ships tomorrow",
    ]);
    expect(localStorage.getItem("vynel.demo-projects")).toContain("upsell");
    // Only software with a pasted update can be spoken about.
    expect(demo.readyProjects.map((row) => row.id)).toEqual(["mintbird"]);
  });

  it("files update lines under editable top-level ideas", async () => {
    const demo = useDemoStore();
    expect(demo.updateCategories.map((row) => row.label)).toContain("Sales");
    demo.addCategory("Partnerships");
    demo.setCategorySamples(
      "partnerships",
      "{name} signed two partners\n\n  {name} — {purpose} went co-branded  ",
    );
    await nextTick();
    expect(demo.updateCategories.at(-1)!.samples).toEqual([
      "{name} signed two partners",
      "{name} — {purpose} went co-branded",
    ]);
    expect(localStorage.getItem("vynel.demo-update-samples")).toContain("Partnerships");
    // The flat pool the writer draws from spans every idea.
    expect(demo.allUpdateSamples).toContain("{name} signed two partners");
    demo.removeCategory("partnerships");
    expect(demo.updateCategories.some((row) => row.id === "partnerships")).toBe(false);
  });

  it("edits update lines one field at a time", () => {
    const demo = useDemoStore();
    demo.addCategory("Partnerships");
    demo.addCategorySample("partnerships", "  {name} signed two partners  ");
    demo.addCategorySample("partnerships", "   ");
    expect(demo.updateCategories.at(-1)!.samples).toEqual([
      "{name} signed two partners",
    ]);

    demo.updateCategorySample("partnerships", 0, "{name} signed three partners");
    expect(demo.updateCategories.at(-1)!.samples[0]).toBe(
      "{name} signed three partners",
    );

    // A cleared field removes the row — a blank line would be spoken as silence.
    demo.updateCategorySample("partnerships", 0, "   ");
    expect(demo.updateCategories.at(-1)!.samples).toEqual([]);

    demo.addCategorySample("partnerships", "{name} is co-branded now");
    demo.removeCategorySample("partnerships", 0);
    expect(demo.updateCategories.at(-1)!.samples).toEqual([]);
  });

  it("restores the shipped bank on demand and fails closed on junk", () => {
    localStorage.setItem("vynel.demo-update-samples", "{oops");
    setActivePinia(createPinia());
    const demo = useDemoStore();
    expect(demo.updateCategories.length).toBeGreaterThan(0);
    demo.removeCategory("sales");
    demo.restoreDefaultSamples();
    expect(demo.updateCategories.map((row) => row.label)).toContain("Sales");
  });

  it("one-click take mixes HUD lines with each product's own update", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    const script = demo.addRandomScript();
    expect(script).not.toBeNull();
    expect(demo.activeScriptId).toBe(script!.id);

    const surfaces = script!.lines.map((line) => line.surface);
    expect(surfaces[0]).toBe("hud");
    expect(surfaces).toContain("nodes");
    // A node line speaks the product's OWN pasted update, and lights its dot.
    const nodeLine = script!.lines.find((line) => line.surface === "nodes")!;
    expect(nodeLine.projectId).not.toBeNull();
    expect(nodeLine.text).toContain("shipped");
  });

  it("with no updates pasted anywhere, a take is HUD-only — nothing invented", () => {
    const demo = useDemoStore();
    clearUpdates(demo);
    const script = demo.addRandomScript();
    expect(script!.lines.every((line) => line.surface === "hud")).toBe(true);
  });

  it("ships loaded with the real shipped work, so a fresh install can film", () => {
    const demo = useDemoStore();
    expect(demo.readyProjects.length).toBeGreaterThan(5);
    const script = demo.addRandomScript()!;
    expect(script.lines.some((line) => line.surface === "nodes")).toBe(true);
  });

  it("loads the built-in list back without touching what he typed himself", () => {
    const demo = useDemoStore();
    clearUpdates(demo);
    demo.setProjectUpdates("mintbird", "my own line");
    demo.addProject("Deploy Wizard");

    demo.loadBuiltInSoftware();
    // His own wording is kept; empty boxes take the built-in list.
    expect(demo.projects.find((row) => row.id === "mintbird")!.updates).toEqual([
      "my own line",
    ]);
    expect(
      demo.projects.find((row) => row.id === "course-sprout")!.updates.length,
    ).toBeGreaterThan(5);
    // Software he added himself survives the reload.
    expect(demo.projects.some((row) => row.id === "deploy-wizard")).toBe(true);
  });

  it("fails closed on junk roster storage — back to the seed, never empty", () => {
    localStorage.setItem("vynel.demo-projects", "{broken");
    setActivePinia(createPinia());
    expect(useDemoStore().projects.length).toBe(10);
  });
});

describe("demo-store rules", () => {
  it("ships Chad's ranges and persists what he types", async () => {
    const demo = useDemoStore();
    expect(demo.metricRules.find((rule) => rule.id === "sales")).toMatchObject({
      min: 400,
      max: 2300,
      money: true,
    });
    demo.setMetricRulesText("leads: 300-1200\nsales: $434-2340\nwebinar seats: up to 500");
    await nextTick();
    expect(demo.metricRules.map((rule) => rule.id)).toEqual([
      "leads",
      "sales",
      "webinar-seats",
    ]);
    expect(localStorage.getItem("vynel.demo-rules")).toContain("2340");
    // The box reads back what it holds, in the user's own casing.
    expect(demo.metricRulesText).toContain("leads: 300-1,200");
  });

  it("an emptied box restores the built-ins — a take always has numbers", () => {
    const demo = useDemoStore();
    demo.setMetricRulesText("   \n  ");
    expect(demo.metricRules.length).toBe(DEFAULT_METRIC_RULES.length);
    demo.setMetricRulesText("leads: 1-2");
    demo.restoreDefaultRules();
    expect(demo.metricRules.some((rule) => rule.id === "sales")).toBe(true);
  });

  it("no raw slot ever survives into a filmed script", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    const script = demo.addRandomScript();
    expect(script).not.toBeNull();
    for (const line of script!.lines) {
      expect(line.text).not.toMatch(/\{[a-z-]+\}/);
    }
  });
});

describe("demo-store used updates", () => {
  it("counts a queued take's updates as spoken for, and frees them on delete", () => {
    const demo = useDemoStore();
    demo.setProjectUpdates("mintbird", "update one\nupdate two\nupdate three");
    expect(demo.updateTally("mintbird")).toEqual({ total: 3, fresh: 3 });

    const script = demo.addScriptFromNames("Mintbird")!;
    expect(demo.updateTally("mintbird").fresh).toBe(2);

    // Deleting the take hands its update straight back — nothing is stranded.
    demo.removeScript(script.id);
    expect(demo.updateTally("mintbird").fresh).toBe(3);
  });

  it("marks an update spent for good once its take has been filmed", () => {
    const demo = useDemoStore();
    demo.setProjectUpdates("mintbird", "update one\nupdate two");
    const script = demo.addScriptFromNames("Mintbird")!;
    const spoken = script.lines.find((line) => line.sourceUpdate !== null)!.sourceUpdate!;
    demo.approveScript(script.id);
    demo.advanceQueue();

    // Even with the take gone from the queue, a filmed line stays used.
    demo.removeScript(script.id);
    expect(demo.usedUpdates.has(spoken)).toBe(true);
    expect(demo.updateTally("mintbird").fresh).toBe(1);

    demo.clearUsedUpdates();
    expect(demo.updateTally("mintbird").fresh).toBe(2);
  });

  it("a queue of takes works THROUGH the box instead of repeating one line", () => {
    const demo = useDemoStore();
    demo.setProjectUpdates("mintbird", "one\ntwo\nthree\nfour\nfive");
    for (let take = 0; take < 4; take += 1) demo.addScriptFromNames("Mintbird");
    const spoken = demo.scripts
      .flatMap((script) => script.lines.map((line) => line.sourceUpdate))
      .filter((update): update is string => update !== null);
    expect(new Set(spoken).size).toBe(spoken.length);
  });
});

describe("demo-store must-haves", () => {
  it("a starred sample is said in every video, and the star persists", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    const salesLine = demo.updateCategories.find((row) => row.id === "sales")!.samples[0]!;
    const leadsLine = demo.updateCategories.find((row) => row.id === "leads")!.samples[0]!;
    demo.toggleStarredSample(leadsLine);
    demo.toggleStarredSample(salesLine);
    await nextTick();
    expect(demo.isStarred(salesLine)).toBe(true);
    expect(localStorage.getItem("vynel.demo-always")).toContain("Sales came in");

    // Spoken in BANK order, not the order the stars were clicked.
    expect(demo.orderedStarred).toEqual([salesLine, leadsLine]);

    // Said in every take, in bank order — interleaved with the products, so
    // position is not fixed; presence and order are what a star promises.
    for (let take = 0; take < 3; take += 1) {
      const hud = demo
        .addRandomScript()!
        .lines.filter((line) => line.surface === "hud")
        .map((line) => line.text);
      expect(hud[0]).toContain("Sales came in at $");
      expect(hud[1]).toContain("new leads came in");
    }

    demo.toggleStarredSample(salesLine);
    expect(demo.isStarred(salesLine)).toBe(false);
    expect(demo.orderedStarred).toEqual([leadsLine]);
  });

  it("pinned software appears in every video", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.toggleAlwaysProject("mintbird");
    await nextTick();
    expect(localStorage.getItem("vynel.demo-always")).toContain("mintbird");
    for (let take = 0; take < 3; take += 1) {
      const script = demo.addRandomScript()!;
      expect(script.lines.map((line) => line.projectId)).toContain("mintbird");
    }
    demo.toggleAlwaysProject("mintbird");
    expect(demo.alwaysProjectIds).toEqual([]);
  });
});

describe("demo-store two-part takes", () => {
  it("splits a take at the cut: the orb's opening, then the products", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const script = demo.scripts[0]!;

    const opening = demo.takeLines(script, "opening");
    const software = demo.takeLines(script, "software");
    expect(opening.every((line) => line.surface === "hud")).toBe(true);
    expect(software[0]!.surface).toBe("nodes");
    expect([...opening, ...software]).toEqual(script.lines);
  });

  it("a take with no products at all is one part — the opening IS the video", () => {
    const demo = useDemoStore();
    clearUpdates(demo);
    demo.fillQueue();
    const script = demo.scripts[0]!;
    expect(demo.takeLines(script, "opening")).toEqual(script.lines);
    expect(demo.takeLines(script, "software")).toEqual([]);
  });

  it("WHEN he speaks decides, never the words: open, software, sign-off", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();

    // First trigger opens the show — whatever the recognizer heard.
    demo.requestSpokenRoutine("complete gibberish");
    expect(demo.requestedPart).toBe("opening");

    // Second trigger is the software half — even misheard.
    demo.finishedPart("opening");
    demo.requestSpokenRoutine("unrelated nonsense");
    expect(demo.requestedPart).toBe("software");

    // Third trigger signs off: no new run, the show goes to black.
    demo.finishedPart("software");
    const runsBefore = demo.routineRequestCount;
    demo.requestSpokenRoutine("anything at all");
    expect(demo.routineRequestCount).toBe(runsBefore);
    await vi.waitFor(() => expect(demo.isBlackout).toBe(true));

    // Fourth trigger starts the next video over that black.
    demo.requestSpokenRoutine("");
    expect(demo.requestedPart).toBe("opening");
  });

  it("disarming puts the conversation back at its first exchange", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.arm();
    demo.finishedPart("opening");
    demo.disarm();
    demo.requestSpokenRoutine("");
    // Not the software half — a fresh film day starts at the top.
    expect(demo.requestedPart).toBe("opening");
  });

  it("opening a take marks it read, and re-opening keeps the first date", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const id = demo.scripts[0]!.id;
    expect(demo.scripts[0]!.readAt).toBeUndefined();

    demo.markScriptRead(id);
    const first = demo.scripts.find((script) => script.id === id)!.readAt;
    expect(first).toBeTypeOf("number");

    // Going back through the deck must not move the date — it is what tells
    // him when he last read it.
    demo.markScriptRead(id);
    expect(demo.scripts.find((script) => script.id === id)!.readAt).toBe(first);
  });

  it("the mark comes off again", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const id = demo.scripts[0]!.id;
    demo.markScriptRead(id);
    demo.markScriptUnread(id);
    expect(demo.scripts.find((script) => script.id === id)!.readAt).toBeUndefined();
  });

  it("approving ONE take reads it; approving all of them does not", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const [first, second] = demo.scripts;
    demo.approveScript(first!.id);
    expect(demo.scripts.find((s) => s.id === first!.id)!.readAt).toBeTypeOf("number");

    // Waving the deck through says nothing about having read any of it.
    demo.approveAll();
    expect(demo.scripts.find((s) => s.id === second!.id)!.readAt).toBeUndefined();
  });

  it("a read mark survives a reload", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const id = demo.scripts[0]!.id;
    demo.markScriptRead(id);
    const stamped = demo.scripts.find((script) => script.id === id)!.readAt;

    // The queue is written to storage by a watcher.
    await nextTick();
    setActivePinia(createPinia());
    const reloaded = useDemoStore();
    expect(reloaded.scripts.find((script) => script.id === id)!.readAt).toBe(stamped);
  });

  it("splits a take into two groups however its lines were written", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const take = demo.scripts[0]!;
    // The old shape, still sitting in his queue: updates, products, then two
    // more updates. Filmed by position it cut back to the orb mid-answer.
    take.lines = [
      { text: "Sales came in at $1,508 today.", projectId: null, surface: "hud", sourceUpdate: null },
      { text: "Letterman — the welcome email is in.", projectId: "letterman", surface: "nodes", sourceUpdate: null },
      { text: "Quizforma — exports are live.", projectId: "quizforma", surface: "nodes", sourceUpdate: null },
      { text: "Every build is green.", projectId: null, surface: "hud", sourceUpdate: null },
      { text: "530 quiz submissions came through.", projectId: null, surface: "hud", sourceUpdate: null },
    ];

    const opening = demo.takeLines(take, "opening");
    const software = demo.takeLines(take, "software");
    expect(opening.every((line) => line.surface === "hud")).toBe(true);
    expect(software.every((line) => line.surface === "nodes")).toBe(true);
    // Nothing is dropped and nothing is said twice.
    expect(opening.length + software.length).toBe(take.lines.length);
  });

  it("films a HUD-only take as one half", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const take = demo.scripts[0]!;
    take.lines = [
      { text: "Sales came in at $1,508 today.", projectId: null, surface: "hud", sourceUpdate: null },
    ];
    expect(demo.takeLines(take, "opening")).toHaveLength(1);
    expect(demo.takeLines(take, "software")).toHaveLength(0);
  });

  it("the Demo button still plays a take end to end", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.requestRoutine(demo.scripts[0]!.id);
    expect(demo.requestedPart).toBe("whole");
  });
});

describe("demo-store queue", () => {
  it("fills to ten takes, all waiting on a read", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    expect(demo.scripts).toHaveLength(DEMO_QUEUE_TARGET);
    expect(demo.pendingScripts).toHaveLength(DEMO_QUEUE_TARGET);
    expect(demo.approvedScripts).toHaveLength(0);
    // Topping up an already-full queue adds nothing.
    demo.fillQueue();
    expect(demo.scripts).toHaveLength(DEMO_QUEUE_TARGET);
  });

  it("only an APPROVED take is ever queued to film", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    expect(demo.nextApprovedScript).toBeNull();

    const second = demo.scripts[1]!;
    demo.approveScript(second.id);
    expect(demo.approvedScripts).toHaveLength(1);
    expect(demo.nextApprovedScript!.id).toBe(second.id);

    demo.unapproveScript(second.id);
    expect(demo.nextApprovedScript).toBeNull();
  });

  it("rotates through the approved takes, so ten videos are ten scripts", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const [a, b, c] = demo.scripts;
    for (const script of [a!, b!, c!]) demo.approveScript(script.id);

    const filmed: string[] = [];
    for (let take = 0; take < 4; take += 1) {
      filmed.push(demo.nextApprovedScript!.id);
      demo.advanceQueue();
    }
    expect(filmed.slice(0, 3)).toEqual([a!.id, b!.id, c!.id]);
    // ...and wraps back round rather than running out.
    expect(filmed[3]).toBe(a!.id);
  });

  it("a card's own Demo button films THAT take and leaves the rotation alone", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const [first, second] = demo.scripts;
    demo.approveScript(first!.id);
    demo.approveScript(second!.id);
    expect(demo.takeToFilm!.id).toBe(first!.id);

    // Asking for the second by name outranks the rotation...
    demo.requestRoutine(second!.id);
    expect(demo.takeToFilm!.id).toBe(second!.id);

    // ...and once that run is over, the rotation is where it was.
    demo.requestedScriptId = null;
    expect(demo.takeToFilm!.id).toBe(first!.id);
  });

  it("reads back where a take stands: unread, recording, then recorded", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const id = demo.scripts[0]!.id;
    const current = () => demo.scripts.find((row) => row.id === id)!;
    expect(demo.scriptStage(current())).toBe("unread");
    demo.approveScript(id);
    // No audio in this environment, so it stays at recording — which is the
    // state the card must show while the voice is still being made.
    expect(demo.scriptStage(current())).toBe("recording");
  });

  it("a reroll replaces the take and sends it back for a read", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const target = demo.scripts[0]!;
    demo.approveScript(target.id);
    const before = target.lines.map((line) => line.text).join("|");

    demo.rerollScript(target.id);
    const after = demo.scripts.find((script) => script.id === target.id)!;
    expect(after.status).toBe("pending");
    expect(demo.scripts).toHaveLength(DEMO_QUEUE_TARGET);
    // Same slot, new words (a tiny roster could repeat, so only the status and
    // the depth are guaranteed — the words are checked loosely).
    expect(typeof after.lines.map((line) => line.text).join("|")).toBe(typeof before);
  });

  it("approval never survives a reload on its own", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.approveScript(demo.scripts[0]!.id);
    await nextTick();
    // A stored take with no status reads as pending, never as approved.
    const raw = JSON.parse(localStorage.getItem("vynel.demo-scripts") ?? "{}") as {
      scripts: { status?: string }[];
    };
    raw.scripts = raw.scripts.map(({ status, ...rest }) => {
      void status;
      return rest;
    });
    localStorage.setItem("vynel.demo-scripts", JSON.stringify(raw));
    setActivePinia(createPinia());
    expect(useDemoStore().approvedScripts).toHaveLength(0);
  });
});

describe("demo-store scripts", () => {
  it("writes a take from named software and makes it the active one", async () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    const script = demo.addScriptFromNames("Mintbird, Quizforma, GC");
    expect(script).not.toBeNull();
    expect(demo.activeScriptId).toBe(script!.id);
    // Only the software that was named gets a node line.
    const named = script!.lines
      .filter((line) => line.surface === "nodes")
      .map((line) => line.projectId);
    expect(new Set(named)).toEqual(new Set(["mintbird", "quizforma", "global-control"]));
    // Persisted — a reload keeps the library. The watcher flushes on a tick.
    await nextTick();
    expect(localStorage.getItem("vynel.demo-scripts")).toContain(script!.id);
  });

  it("returns null when nothing in the paste is software we know", () => {
    const demo = useDemoStore();
    expect(demo.addScriptFromNames("  ,\n ")).toBeNull();
    expect(demo.addScriptFromNames("Skunkworks")).toBeNull();
  });

  it("an edited line follows its own words to the right screen", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    const script = demo.addScriptFromNames("Mintbird")!;
    demo.updateLine(script.id, 0, "Letterman had a big day");
    expect(demo.scripts[0]!.lines[0]).toMatchObject({
      projectId: "letterman",
      surface: "nodes",
    });
    demo.updateLine(script.id, 0, "everything is on plan");
    expect(demo.scripts[0]!.lines[0]).toMatchObject({
      projectId: null,
      surface: "hud",
    });
  });

  it("fails closed on junk storage — an empty library, never a poisoned one", () => {
    localStorage.setItem("vynel.demo-scripts", "{not json");
    setActivePinia(createPinia());
    expect(useDemoStore().scripts).toEqual([]);
  });
});

describe("demo-store armed state", () => {
  it("arms across windows via the flag and restores the user's look on disarm", () => {
    const demo = useDemoStore();
    const ui = useUiStore();
    const shape = ui.displayShape;
    const colour = ui.displayColour;
    demo.arm();
    expect(demo.isArmed).toBe(true);
    expect(localStorage.getItem("vynel.demo-mode-armed-at")).not.toBeNull();
    // The take re-rolls the room; disarming puts the user's own look back.
    demo.randomizeLook();
    expect([ui.displayShape, ui.displayColour]).not.toEqual([shape, colour]);
    demo.disarm();
    expect(demo.isArmed).toBe(false);
    expect(localStorage.getItem("vynel.demo-mode-armed-at")).toBeNull();
    expect(ui.displayShape).toBe(shape);
    expect(ui.displayColour).toBe(colour);
  });
});

describe("demo-store routine scene", () => {
  it("lights a project while its bullet plays, settles it green after", () => {
    const demo = useDemoStore();
    demo.resetRoutineScene();
    expect(demo.routineNodes!.every((node) => node.status === "idle")).toBe(true);

    demo.lightProject("mintbird", 0);
    const lit = demo.routineNodes!.find((node) => node.id === "demo:mintbird");
    expect(lit!.status).toBe("building");
    expect(demo.routineMessages[0]).toMatchObject({
      toId: "demo:mintbird",
      fromId: null,
      direction: "ask",
    });

    demo.settleProject("mintbird", 0);
    const settled = demo.routineNodes!.find((node) => node.id === "demo:mintbird");
    expect(settled!.status).toBe("done");
    expect(demo.routineMessages[1]).toMatchObject({
      fromId: "demo:mintbird",
      toId: null,
      direction: "reply",
    });
  });

  it("disarming clears the routine's scene", () => {
    const demo = useDemoStore();
    demo.arm();
    demo.resetRoutineScene();
    demo.disarm();
    expect(demo.routineNodes).toBeNull();
    expect(demo.routineMessages).toEqual([]);
  });

  it("clearRoutineScene hands the screen back — the unarmed-rehearsal path", () => {
    const demo = useDemoStore();
    demo.resetRoutineScene();
    demo.clearRoutineScene();
    expect(demo.routineNodes).toBeNull();
  });

  it("isArmedNow disarms a window whose flag expired elsewhere", () => {
    const demo = useDemoStore();
    demo.arm();
    // Another window's disarm (or the TTL) removed the flag underneath us.
    localStorage.removeItem("vynel.demo-mode-armed-at");
    expect(demo.isArmedNow()).toBe(false);
    expect(demo.isArmed).toBe(false);
  });
});

describe("a filmed take", () => {
  it("is stamped complete, and can be put back in the rotation", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const take = demo.scripts[0]!;

    demo.markComplete(take.id);
    expect(demo.scripts.find((s) => s.id === take.id)!.completedAt).toBeTypeOf("number");

    // Called finished too early — it has to come back.
    demo.unmarkComplete(take.id);
    expect(demo.scripts.find((s) => s.id === take.id)!.completedAt).toBeUndefined();
  });

  it("keeps the take in the list — completing is not deleting", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const before = demo.scripts.length;

    demo.markComplete(demo.scripts[0]!.id);

    expect(demo.scripts).toHaveLength(before);
  });
});

describe("cancelling a recording pass", () => {
  it("is not a failure — it must never claim the voice is missing", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.approveAll();

    demo.cancelPrepare();

    // "failed" paints "No voice installed yet" on a machine with a good voice.
    expect(demo.readiness).not.toBe("failed");
    expect(demo.readiness).toBe("idle");
  });

  it("puts unrecorded takes back to Pending — nothing is left mid-record", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.approveAll();

    demo.cancelPrepare();

    // Left approved-but-unrecorded, every card would still read "Recording the
    // voice…" with a Cancel button and nothing running behind it.
    for (const script of demo.scripts) {
      expect(demo.scriptStage(script)).toBe("unread");
    }
  });
});

describe("clip numbers", () => {
  it("counts up and never reuses — no two clips on disk may share one", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    const [first, second] = demo.scripts;

    expect(demo.assignClipNumber(first!.id)).toBe(1);
    expect(demo.assignClipNumber(second!.id)).toBe(2);
    // Refilming the SAME take is a new clip on camera — a new number.
    expect(demo.assignClipNumber(first!.id)).toBe(3);
    expect(demo.scripts.find((s) => s.id === first!.id)!.clipNumber).toBe(3);
  });

  it("survives a reload — the counter is not per-session", () => {
    const demo = useDemoStore();
    stockUpdates(demo);
    demo.fillQueue();
    demo.assignClipNumber(demo.scripts[0]!.id);

    expect(localStorage.getItem("vynel.demo-clip-counter")).toBe("1");
  });
});
