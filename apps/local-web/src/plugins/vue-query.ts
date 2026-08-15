import { MutationCache, QueryCache, QueryClient } from "@tanstack/vue-query";
import { isOnboardingRequiredError } from "../utils/onboarding-required-error.js";
import { SECTION_COUNTS_KEY } from "../composables/workspaces/use-section-counts.js";

export interface AppQueryClientOptions {
  /** Fired when any query/mutation hits the first-launch gate's 412 —
   *  main.ts routes this into the onboarding store so the wizard takes over. */
  onOnboardingRequired?: () => void;
}

// One QueryClient for the app (letterman conventions): server state lives in
// vue-query, Pinia holds UI state only. The caches carry the single global
// error hook — the first-launch 412 is a shell-level concern no individual
// view should have to handle.
export function createAppQueryClient(
  options: AppQueryClientOptions = {},
): QueryClient {
  const inspectError = (error: unknown) => {
    if (isOnboardingRequiredError(error)) options.onOnboardingRequired?.();
  };
  // The menu's per-section counts are a DERIVED decoration over a dozen
  // features, so they refresh after any successful mutation rather than
  // asking every mutation composable to remember them — a rule each new
  // feature would have to re-learn, and would silently break by forgetting.
  // The number beside a row must never disagree with the rows behind it.
  const refreshSectionCounts = () => {
    void client.invalidateQueries({ queryKey: [SECTION_COUNTS_KEY] });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: inspectError }),
    mutationCache: new MutationCache({
      onError: inspectError,
      onSuccess: refreshSectionCounts,
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
  return client;
}
