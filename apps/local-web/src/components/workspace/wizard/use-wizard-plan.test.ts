// The plan state's guards, without a screen: a late reply never lands over a
// score or past the plan screen; a failed synthesis is SAID, and the
// mechanical plan stays; a site study fails visibly too.

import { describe, expect, it } from "vitest";
import { nextTick, reactive } from "vue";
import {
  makeEmptyAnswers,
  type WizardAnswers,
  type WizardStepId,
} from "./wizard-steps.js";
import { useWizardPlan, type WizardPlanEngine } from "./use-wizard-plan.js";

function answered(): WizardAnswers {
  return reactive({
    ...makeEmptyAnswers(),
    parentPath: "C:\\Users\\chad\\Projects",
    appName: "Front of House",
    idea: "A place where my regulars can book a table.",
    who: "My customers",
    first: "Book a table for a date and time",
    signin: "No, open to everyone",
    where: "A website",
    remembers: ["Bookings"],
  });
}

function makePlan(marker: string) {
  return {
    oneLine: marker,
    build: [{ text: marker, source: "your answers" }],
    remembers: ["Bookings"],
    leftOut: [],
    mvpNutshell: marker,
    goals: [{ title: marker, bullets: [marker] }],
    sessions: [{ name: marker, items: [marker], mvp: true }],
  };
}

function deferredEngine() {
  const pending: Array<(plan: ReturnType<typeof makePlan> | null) => void> = [];
  const engine: WizardPlanEngine = {
    synthesizePlan: () =>
      new Promise((resolve) => pending.push((plan) => resolve({ plan }))),
    studyRival: async () => ({ study: null }),
  };
  return { engine, pending };
}

describe("useWizardPlan", () => {
  it("shows the mechanical plan at once, then the synthesis when it lands on an unscored plan screen", async () => {
    const answers = answered();
    const { engine, pending } = deferredEngine();
    const state = useWizardPlan(answers, () => "plan", engine);

    expect(state.plan.value.oneLine).toContain("book a table");
    void state.synthesize();
    expect(state.isSynthesizing.value).toBe(true);

    pending[0]!(makePlan("THE POLISHED PLAN"));
    await nextTick();
    await nextTick();
    expect(state.plan.value.oneLine).toBe("THE POLISHED PLAN");
    expect(state.isSynthesizing.value).toBe(false);
    expect(state.synthesisFailed.value).toBe(false);
  });

  it("never lands over a score the user already gave, nor past the plan screen", async () => {
    const answers = answered();
    const { engine, pending } = deferredEngine();
    let step: WizardStepId = "plan";
    const state = useWizardPlan(answers, () => step, engine);

    void state.synthesize();
    answers.score = 10;
    pending[0]!(makePlan("AFTER THE SCORE"));
    await nextTick();
    await nextTick();
    expect(state.plan.value.oneLine).not.toBe("AFTER THE SCORE");

    answers.score = null;
    answers.changeRequests.push("Nobody should have to sign in just to look.");
    void state.synthesize();
    step = "goals";
    pending[1]!(makePlan("PAST THE SCREEN"));
    await nextTick();
    await nextTick();
    expect(state.plan.value.oneLine).not.toBe("PAST THE SCREEN");
  });

  it("a failed or empty synthesis is said, and the mechanical plan stays", async () => {
    const answers = answered();
    const failing: WizardPlanEngine = {
      synthesizePlan: async () => {
        throw new Error("boom");
      },
      studyRival: async () => {
        throw new Error("boom");
      },
    };
    const state = useWizardPlan(answers, () => "plan", failing);

    await state.synthesize();
    expect(state.synthesisFailed.value).toBe(true);
    expect(state.plan.value.oneLine).toContain("book a table");

    answers.rivalDraft = "https://OpenTable.com/";
    await state.studyRival();
    expect(answers.rivals).toEqual(["opentable.com"]);
    expect(state.studies["opentable.com"]).toEqual({ state: "failed" });

    const empty: WizardPlanEngine = {
      synthesizePlan: async () => ({ plan: null }),
      studyRival: async () => ({ study: null }),
    };
    const quiet = useWizardPlan(answered(), () => "plan", empty);
    await quiet.synthesize();
    expect(quiet.synthesisFailed.value).toBe(true);
  });

  it("editing a plan-shaping answer retires a landed synthesis", async () => {
    const answers = answered();
    const { engine, pending } = deferredEngine();
    const state = useWizardPlan(answers, () => "plan", engine);
    void state.synthesize();
    pending[0]!(makePlan("LANDED"));
    await nextTick();
    await nextTick();
    expect(state.plan.value.oneLine).toBe("LANDED");

    answers.remembers.push("Payments");
    await nextTick();
    expect(state.plan.value.oneLine).not.toBe("LANDED");
  });
});
