// Tests for the wizard's step machine + the mechanical fallback derivations
// — the plan screens must never be empty, and every gate speaks.

import { describe, expect, it } from "vitest";
import {
  WIZARD_LAST,
  WIZARD_STEPS,
  makeEmptyAnswers,
  toBriefAnswers,
  wizardGate,
  type WizardAnswers,
} from "./wizard-steps.js";
import { deriveFallbackPlan } from "./derive-fallback-plan.js";
import { chosenStack, deriveStackRows } from "./derive-stack.js";

const SIGNED_IN = { isSignedIn: true };
const SIGNED_OUT = { isSignedIn: false };

function answeredThroughQ2(): WizardAnswers {
  return {
    ...makeEmptyAnswers(),
    directory: "C:\\Users\\chad\\Projects",
    appName: "Front of House",
    idea: "A place where my regulars can book a table.",
    who: "My customers",
    first: "Book a table for a date and time",
    signin: "No, open to everyone",
    where: "A website",
    remembers: ["Bookings"],
  };
}

describe("the step machine", () => {
  it("is the 12 numbered steps plus Done, with the folder first", () => {
    expect(WIZARD_STEPS).toHaveLength(13);
    expect(WIZARD_LAST).toBe(12);
    expect(WIZARD_STEPS[0]).toBe("place");
    expect(WIZARD_STEPS[1]).toBe("idea");
    expect(WIZARD_STEPS[12]).toBe("done");
  });

  it("every gated step says what it still needs", () => {
    const empty = makeEmptyAnswers();
    expect(wizardGate("place", empty, SIGNED_IN)).toContain("folder");
    expect(
      wizardGate("place", { ...empty, directory: "C:\\x" }, SIGNED_IN),
    ).toContain("name");
    expect(wizardGate("idea", empty, SIGNED_IN)).toContain("idea");
    expect(wizardGate("q1", empty, SIGNED_IN)).toContain("all three");
    expect(wizardGate("q2", empty, SIGNED_IN)).toContain("both");
    expect(wizardGate("plan", empty, SIGNED_IN)).toContain("Score it");
    expect(wizardGate("goals", empty, SIGNED_IN)).toContain("MVP");
    expect(wizardGate("sessions", empty, SIGNED_IN)).toContain("Approve");
  });

  it("the account gate is the GLOBAL sign-in, not an answer", () => {
    const empty = makeEmptyAnswers();
    expect(wizardGate("account", empty, SIGNED_OUT)).toContain("Sign in");
    expect(wizardGate("account", empty, SIGNED_IN)).toBeNull();
  });

  it("the plan gate walks: score → tell-us-what-to-change → clear at 10", () => {
    const answers = answeredThroughQ2();
    expect(wizardGate("plan", answers, SIGNED_IN)).toContain("Score it");
    answers.score = 6;
    expect(wizardGate("plan", answers, SIGNED_IN)).toContain("what to change");
    answers.changes = "Nobody should have to sign in just to look.";
    expect(wizardGate("plan", answers, SIGNED_IN)).toBeNull();
    answers.score = 10;
    answers.changes = "";
    expect(wizardGate("plan", answers, SIGNED_IN)).toBeNull();
  });

  it("ungated steps are clear", () => {
    const empty = makeEmptyAnswers();
    for (const step of ["rivals", "wants", "stack", "care", "done"] as const) {
      expect(wizardGate(step, empty, SIGNED_IN)).toBeNull();
    }
  });
});

describe("toBriefAnswers", () => {
  it("folds the advanced picks that differ from their defaults into the notes — a lit chip never goes nowhere", () => {
    const answers = {
      ...answeredThroughQ2(),
      stackPicks: { lang: "JavaScript", pkg: "pnpm", data: "Drizzle" },
      advNotes: "no ORM magic",
    };
    expect(toBriefAnswers(answers, []).advancedNotes).toBe(
      "Language: JavaScript · Data access: Drizzle; no ORM magic",
    );
    expect(
      toBriefAnswers(
        { ...answeredThroughQ2(), stackPicks: { lang: "TypeScript" } },
        [],
      ).advancedNotes,
    ).toBeUndefined();
  });

  it("is the engine's view of the answers: defaults for the unanswered, the stack resolved, notes only when written", () => {
    const answers = answeredThroughQ2();
    answers.changeRequests.push("No sign-in just to look.");
    const brief = toBriefAnswers(answers, ["The sales pitch"]);
    expect(brief.audience).toBe("My customers");
    expect(brief.firstThing).toBe("Book a table for a date and time");
    expect(brief.leftOut).toEqual(["The sales pitch"]);
    expect(brief.changeRequests).toEqual(["No sign-in just to look."]);
    expect(brief.stack).toEqual(chosenStack(answers));
    expect("advancedNotes" in brief).toBe(false);

    const bare = toBriefAnswers(
      { ...makeEmptyAnswers(), advNotes: "  pnpm  " },
      [],
    );
    expect(bare.audience).toBe("your people");
    expect(bare.signIn).toBe("No, open to everyone");
    expect(bare.where).toBe("A website");
    expect(bare.advancedNotes).toBe("pnpm");
  });
});

describe("deriveFallbackPlan", () => {
  it("every line traces to an answer, wants keep their source, nothing invented", () => {
    const answers = answeredThroughQ2();
    answers.wants = [
      { text: "It remembers them", from: "opentable.com" },
      { text: "Leave a note with the booking", from: "you" },
    ];
    const plan = deriveFallbackPlan(answers, ["The sales pitch"]);

    expect(plan.oneLine).toBe(
      "A website where your customers can book a table for a date and time.",
    );
    expect(plan.build[0]).toEqual({
      text: "Let people book a table for a date and time",
      source: "your answers",
    });
    expect(plan.build).toContainEqual({
      text: "It remembers them",
      source: "opentable.com",
    });
    expect(plan.build).toContainEqual({
      text: "Leave a note with the booking",
      source: "you added",
    });
    expect(plan.leftOut).toEqual(["The sales pitch"]);
    expect(plan.mvpNutshell).toContain("Nothing you ticked has been dropped");
    expect(plan.goals.length).toBeGreaterThanOrEqual(3);
    expect(
      plan.goals.some((goal) => goal.title.includes("liked on other sites")),
    ).toBe(true);
  });

  it("sessions start by setting the project up, end checking it over, and mark after-MVP work", () => {
    const plan = deriveFallbackPlan(answeredThroughQ2(), []);
    expect(plan.sessions[0]?.name).toBe("Set the project up");
    const mvp = plan.sessions.filter((session) => session.mvp);
    expect(mvp.at(-1)?.name).toBe("Check it over and hand it to you");
    expect(plan.sessions.some((session) => !session.mvp)).toBe(true);
    expect(plan.sessions.length).toBeGreaterThanOrEqual(12);
  });

  it("sign-in answers change the goals and the sessions", () => {
    const answers = { ...answeredThroughQ2(), signin: "One shared password" };
    const plan = deriveFallbackPlan(answers, []);
    expect(plan.goals[0]?.bullets).toContain(
      "One shared password keeps it private",
    );
    expect(plan.remembers[0]).toBe("People and how they sign in");
    expect(plan.sessions.some((session) => session.name === "Signing in")).toBe(
      true,
    );
  });
});

describe("deriveStackRows", () => {
  it("picks by the answers: phone → Expo, public no-products → Nuxt, busy data → Postgres", () => {
    const base = answeredThroughQ2();
    expect(deriveStackRows({ ...base, where: "A phone app" })[0]?.value).toBe(
      "Expo (React Native)",
    );
    expect(deriveStackRows(base)[0]?.value).toBe("Nuxt.js");
    expect(deriveStackRows(base)[1]?.value).toBe("Nitro (built into Nuxt)");
    expect(
      deriveStackRows({
        ...base,
        remembers: ["Bookings", "People", "Payments"],
      })[2]?.value,
    ).toBe("Postgres");
  });

  it("user picks override, the back end follows the picked front end, and every value carries its reason", () => {
    const answers = {
      ...answeredThroughQ2(),
      stackPicks: { framework: "Next.js" },
    };
    const rows = deriveStackRows(answers);
    expect(rows[0]?.value).toBe("Next.js");
    for (const row of rows) expect(row.note.length).toBeGreaterThan(0);
    expect(chosenStack(answers)).toEqual({
      front: "Next.js",
      back: "Next.js API routes",
      database: "SQLite",
    });
  });
});
