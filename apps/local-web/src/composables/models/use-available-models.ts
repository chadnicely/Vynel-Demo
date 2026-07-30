import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The model picker's source: the roster the engine reported (persisted on
// every interactive turn), or the curated static floor before the first
// discovery. Long stale time — the roster changes when the engine updates,
// not per click; each settle-invalidation-free read is fine because a stale
// picker only lags a label, never correctness (the engine validates the id).
export const availableModelsKeys = {
  all: ["available-models"] as const,
};

export function useAvailableModels() {
  const vynel = useVynel();
  return useQuery({
    queryKey: availableModelsKeys.all,
    queryFn: () => vynel.providers.listModels("claude"),
    staleTime: 5 * 60_000,
  });
}
