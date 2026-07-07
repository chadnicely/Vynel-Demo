import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { onboardingKeys } from "./onboarding-keys.js";

// The wizard's server shapes, inferred from the typed SDK so the wire is the
// single source of truth (no hand-copied response types).
export type OnboardingRun = Awaited<
  ReturnType<VynelClient["onboarding"]["start"]>
>;
export type OnboardingSnapshot = Awaited<
  ReturnType<VynelClient["onboarding"]["getRunStatus"]>
>;
export type OnboardingStepKind = OnboardingRun["currentStepKind"];

export function useStartOnboarding() {
  const vynel = useVynel();
  return useMutation({
    // startOnboardingRun resumes an in-progress run, so calling it on every
    // wizard mount is safe — a half-finished setup picks up where it left off.
    mutationFn: () => vynel.onboarding.start(),
  });
}

export function useRestartOnboarding() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vynel.onboarding.restart(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
  });
}

export function useOnboardingRunStatus(runId: Ref<string | null>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => onboardingKeys.runStatus(runId.value ?? "none")),
    // enabled guards the sentinel key — "none" never becomes a request.
    queryFn: () => vynel.onboarding.getRunStatus(runId.value as string),
    enabled: computed(() => runId.value !== null),
  });
}

export interface SubmitOnboardingStepInput {
  runId: string;
  stepKind: OnboardingStepKind;
  stepInput: unknown;
}

export function useSubmitOnboardingStep() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitOnboardingStepInput) =>
      vynel.onboarding.submitStep(input.runId, {
        stepKind: input.stepKind,
        stepInput: input.stepInput,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
  });
}
