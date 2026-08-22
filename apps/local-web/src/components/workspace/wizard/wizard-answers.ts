// The wizard's one draft, shared with its screens the way a store would be —
// provided by `WorkspaceWizard`, read by every step. The screens write into
// it directly (that is what a form draft is for); what they never do is
// mutate a prop — props stay down, the draft is injected.

import { inject, provide, type InjectionKey } from "vue";
import type { WizardAnswers } from "./wizard-steps.js";

const wizardAnswersKey: InjectionKey<WizardAnswers> = Symbol("wizard-answers");

export function provideWizardAnswers(answers: WizardAnswers): void {
  provide(wizardAnswersKey, answers);
}

export function useWizardAnswers(): WizardAnswers {
  const answers = inject(wizardAnswersKey, null);
  if (answers === null) {
    throw new Error(
      "useWizardAnswers: no wizard draft provided — mount this step inside WorkspaceWizard.",
    );
  }
  return answers;
}
