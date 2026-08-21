import type { TaskStepResponse } from "@vynel/contracts/tasks/task-step-http";

export interface CurrentStep {
  /** 1-based position in the plan — what a person calls "step 3". */
  number: number;
  title: string;
}

/** The step being worked right now: the one in progress, else the first
 *  still open. Null for a plan with nothing left (or no steps at all). */
export function currentStepOf(steps: readonly TaskStepResponse[]): CurrentStep | null {
  const working = steps.findIndex((step) => step.status === "in-progress");
  const index = working !== -1 ? working : steps.findIndex((step) => step.status === "open");
  if (index === -1) return null;
  return { number: index + 1, title: steps[index]!.title };
}
