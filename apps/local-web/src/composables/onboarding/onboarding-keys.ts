export const onboardingKeys = {
  all: ["onboarding"] as const,
  runStatus: (runId: string) => [...onboardingKeys.all, "run", runId] as const,
};
