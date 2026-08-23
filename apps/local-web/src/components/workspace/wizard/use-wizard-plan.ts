// The wizard's plan state — the rival studies, the AI synthesis and the
// mechanical fallback, and the race guards between them. Pulled out of the
// orchestrator so the guards are testable without mounting thirteen screens.
//
// The plan the screens read is the AI synthesis when it has landed, the
// mechanical derivation from the answers until then (and whenever it fails)
// — the screen is never empty, and never pretends.

import { computed, reactive, ref, watch } from "vue";
import type {
  WorkspaceBriefAnswers,
  WorkspacePlan,
} from "@vynel/contracts/workspaces/workspace-brief";
import { deriveFallbackPlan } from "./derive-fallback-plan.js";
import {
  toBriefAnswers,
  type WizardAnswers,
  type WizardStepId,
} from "./wizard-steps.js";
import { cleanSiteName, type RivalStudyOutcome } from "./wizard-study.js";

export type WizardPlanEngine = {
  synthesizePlan: (
    input: Omit<WorkspaceBriefAnswers, "advancedNotes"> & { directory: string },
  ) => Promise<{ plan: WorkspacePlan | null }>;
  studyRival: (input: {
    site: string;
    idea: string;
    directory: string;
  }) => Promise<{
    study: Omit<Extract<RivalStudyOutcome, { state: "ready" }>, "state"> | null;
  }>;
};

export function useWizardPlan(
  answers: WizardAnswers,
  stepId: () => WizardStepId,
  engine: WizardPlanEngine,
) {
  const studies = reactive<Record<string, RivalStudyOutcome>>({});
  const aiPlan = ref<WorkspacePlan | null>(null);
  const synthesizedForKey = ref<string | null>(null);
  const inFlightKey = ref<string | null>(null);
  const pendingSyntheses = ref(0);
  const isSynthesizing = computed(() => pendingSyntheses.value > 0);
  // Said on the screen, never swallowed: the polished read did not come.
  const synthesisFailed = ref(false);

  // The leave-outs collected across every site still on the chip row.
  const leftOut = computed(() => {
    const collected: string[] = [];
    for (const site of answers.rivals) {
      const study = studies[site];
      if (study?.state !== "ready") continue;
      for (const line of study.leaveOut)
        if (!collected.includes(line)) collected.push(line);
    }
    return collected;
  });

  const plan = computed<WorkspacePlan>(
    () => aiPlan.value ?? deriveFallbackPlan(answers, leftOut.value),
  );

  // The answers the plan FOLLOWS ("if any of this looks off, go back and
  // change your answers"). Goal notes and stack picks ride the synthesis
  // payload + the brief but deliberately not the key: sending a note or
  // changing the database must not retire a plan the user already read.
  const currentSynthesisKey = computed(() =>
    JSON.stringify({
      idea: answers.idea,
      who: answers.who,
      first: answers.first,
      signin: answers.signin,
      where: answers.where,
      remembers: answers.remembers,
      wants: answers.wants,
      leftOut: leftOut.value,
      changeRequests: answers.changeRequests,
    }),
  );

  // Editing a plan-shaping answer retires the landed synthesis on the spot —
  // the screens fall back to the mechanical derivation rather than show an AI
  // plan the answers no longer match.
  watch(currentSynthesisKey, (key) => {
    if (synthesizedForKey.value !== null && synthesizedForKey.value !== key) {
      aiPlan.value = null;
      synthesizedForKey.value = null;
    }
  });

  // A reply lands only while it still answers the CURRENT answers and the
  // user is on the plan screen with no score given yet — a plan they already
  // rated (even the mechanical one) or moved past is never swapped under
  // them. The change-request loop clears the score, so re-syntheses land.
  function mayLand(key: string): boolean {
    return (
      currentSynthesisKey.value === key &&
      stepId() === "plan" &&
      answers.score === null
    );
  }

  async function synthesize(): Promise<void> {
    const directory = answers.directory;
    if (directory === null) return;
    const key = currentSynthesisKey.value;
    if (synthesizedForKey.value === key || inFlightKey.value === key) return;
    inFlightKey.value = key;
    pendingSyntheses.value += 1;
    synthesisFailed.value = false;
    try {
      // The advanced notes ride the brief, not the synthesis.
      const { advancedNotes: _advancedNotes, ...fields } = toBriefAnswers(
        answers,
        leftOut.value,
      );
      const reply = await engine.synthesizePlan({ ...fields, directory });
      if (reply.plan === null) {
        // Nothing to show — the mechanical plan stays; revisiting retries.
        synthesisFailed.value = true;
      } else if (mayLand(key)) {
        aiPlan.value = reply.plan;
        synthesizedForKey.value = key;
      } else if (currentSynthesisKey.value !== key && stepId() === "plan") {
        void synthesize();
      }
    } catch {
      synthesisFailed.value = true;
    } finally {
      if (inFlightKey.value === key) inFlightKey.value = null;
      pendingSyntheses.value -= 1;
    }
  }

  async function studyRival(): Promise<void> {
    const directory = answers.directory;
    const site = cleanSiteName(answers.rivalDraft);
    if (site.length < 4 || directory === null) return;
    if (!answers.rivals.includes(site)) answers.rivals.push(site);
    answers.rivalDraft = "";
    studies[site] = { state: "loading" };
    try {
      const reply = await engine.studyRival({
        site,
        idea: answers.idea,
        directory,
      });
      studies[site] =
        reply.study === null
          ? { state: "failed" }
          : { state: "ready", ...reply.study };
    } catch {
      studies[site] = { state: "failed" };
    }
  }

  function removeRival(site: string): void {
    const at = answers.rivals.indexOf(site);
    if (at >= 0) answers.rivals.splice(at, 1);
    delete studies[site];
  }

  function reset(): void {
    for (const key of Object.keys(studies)) delete studies[key];
    aiPlan.value = null;
    synthesizedForKey.value = null;
    inFlightKey.value = null;
    synthesisFailed.value = false;
  }

  return {
    studies,
    plan,
    leftOut,
    isSynthesizing,
    synthesisFailed,
    synthesize,
    studyRival,
    removeRival,
    reset,
  };
}
